from copy import deepcopy

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.models import PartRevision


@pytest.fixture
def catalog_admin(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "catalog-test-administrator-key")
    response = client.post("/api/auth/login", json={"employeeNumber": "0000", "adminKey": "catalog-test-administrator-key"})
    assert response.status_code == 200
    return client


def create(client, number="TEST-NEW"):
    response = client.post("/api/admin/catalog/parts", json={"number": number, "name": "Threaded fixture block", "description": "Synthetic admin workflow", "revisionCode": "A", "material": "6061-T6", "finish": "Machined", "geometryFamily": "threaded-block", "operation": {"code": "010", "name": "Finish machining", "setup": "Locate on datum A"}})
    assert response.status_code == 201, response.text
    return response.json()


def feature(number=1, mode="minimum", nominal=18):
    return {"number": number, "label": "Full thread depth", "type": "dimensional", "nominal": nominal, "toleranceMinus": 0, "tolerancePlus": 0, "limitType": mode, "unit": "mm", "method": "Calibrated thread depth gauge", "datum": "A", "instruction": "Zero on datum A and read full thread engagement depth per the approved gauge procedure.", "sketchRef": f"{number:02}", "animationKey": "thread-depth", "zone": "Threaded holes", "critical": True}


def save(client, part, features=None, **updates):
    body = {"material": part["material"], "finish": part["finish"], "geometryFamily": part["revision"]["geometryFamily"], "changeNote": "Prepared for review", "operation": {key: part["operation"][key] for key in ("code", "name", "setup")}, "features": features if features is not None else part["features"]}
    body.update(updates)
    return client.put(f"/api/admin/catalog/revisions/{part['revision']['id']}", json=body)


def release(client, part, activate=True):
    return client.post(f"/api/admin/catalog/revisions/{part['revision']['id']}/release", json={"activate": activate})


def start(client, part):
    return client.post("/api/runs", json={"partRevisionId": part["revision"]["id"], "operationId": part["operation"]["id"], "inspector": "Spoofed name", "jobNumber": "JOB-CATALOG-1", "sampleNumber": "01"})


def test_operator_cannot_create_parts_or_admin_revisions(client):
    assert client.get("/api/admin/catalog/parts").status_code == 403
    assert client.post("/api/admin/catalog/parts", json={}).status_code == 403
    assert client.get("/api/admin/catalog/revisions/rev-dg1042-c").status_code == 403


def test_create_prepare_release_and_activate_pipeline(catalog_admin):
    client = catalog_admin
    part = create(client)
    assert part["revision"]["status"] == "draft" and not part["revision"]["isActive"]
    assert part["revision"]["createdBy"] == "0000"
    assert part["features"] == []
    assert client.get("/api/parts/TEST-NEW").status_code == 404
    assert release(client, part).status_code == 409
    prepared = save(client, part, [feature()])
    assert prepared.status_code == 200, prepared.text
    part = prepared.json()
    assert part["references"]["geometryFamily"] == "threaded-block"
    assert part["references"]["modelAvailable"] is True
    assert part["references"]["sketch"] is None
    released = release(client, part, activate=False)
    assert released.status_code == 200, released.text
    assert released.json()["revision"]["releasedBy"] == "0000"
    assert client.get("/api/parts/TEST-NEW").status_code == 404
    active = client.post(f"/api/admin/catalog/revisions/{part['revision']['id']}/active", json={"active": True})
    assert active.status_code == 200, active.text
    assert client.get("/api/parts/TEST-NEW").json()["revision"]["isActive"] is True
    started = start(client, part)
    assert started.status_code == 201
    assert started.json()["employeeNumber"] == "0000"
    assert started.json()["inspector"] == "Administrator"
    assert save(client, part, [feature()]).status_code == 409


def test_revision_clone_gets_new_ids_and_activation_preserves_archived_sheets(catalog_admin, database):
    client = catalog_admin
    part = save(client, create(client), [feature()]).json()
    part = release(client, part).json()
    old_run = start(client, part).json()
    cloned = client.post("/api/admin/catalog/parts/TEST-NEW/revisions", json={"code": "B", "sourceRevisionId": part["revision"]["id"], "changeNote": "Increase usable thread depth"})
    assert cloned.status_code == 201, cloned.text
    draft = cloned.json()
    assert draft["features"][0]["id"] != part["features"][0]["id"]
    assert draft["operation"]["id"] != part["operation"]["id"]
    assert draft["revision"]["status"] == "draft"
    assert client.get("/api/parts/TEST-NEW").json()["revision"]["code"] == "A"
    changed = deepcopy(draft["features"])
    changed[0]["nominal"] = 20
    draft = save(client, draft, changed).json()
    activated = release(client, draft).json()
    assert activated["revision"]["isActive"]
    assert client.get("/api/parts/TEST-NEW").json()["revision"]["code"] == "B"
    assert start(client, part).status_code == 409
    historical = client.get(f"/api/parts/TEST-NEW?revisionId={part['revision']['id']}").json()
    assert historical["revision"]["code"] == "A" and not historical["revision"]["isActive"]
    assert historical["features"][0]["nominal"] == 18
    assert client.get(f"/api/runs/{old_run['id']}").json()["partRevisionId"] == part["revision"]["id"]
    assert client.post(f"/api/runs/{old_run['id']}/measurements", json={"shift": "1", "featureId": part["features"][0]["id"], "value": 18}).status_code == 201
    assert client.post(f"/api/admin/catalog/revisions/{activated['revision']['id']}/active", json={"active": False}).status_code == 200
    assert client.get("/api/parts/TEST-NEW").status_code == 404
    with database() as session:
        revisions = session.scalars(select(PartRevision).where(PartRevision.part_id == part["id"])).all()
        assert not any(r.is_active for r in revisions)


def test_database_rejects_two_active_revisions_and_released_requirement_edits(catalog_admin, database):
    client = catalog_admin
    original = save(client, create(client), [feature()]).json()
    original = release(client, original).json()
    clone = client.post("/api/admin/catalog/parts/TEST-NEW/revisions", json={"code": "B"}).json()
    clone = release(client, clone).json()
    for sql, parameters in [("UPDATE part_revisions SET is_active=1 WHERE id=:id", {"id": original["revision"]["id"]}), ("UPDATE part_revisions SET material='Changed' WHERE id=:id", {"id": clone["revision"]["id"]}), ("UPDATE characteristics SET limit_type='maximum' WHERE id=:id", {"id": clone["features"][0]["id"]})]:
        with pytest.raises(IntegrityError), database.begin() as session:
            session.execute(text(sql), parameters)


@pytest.mark.parametrize("mode,nominal,value,expected", [("minimum", 18, 18, "pass"), ("minimum", 18, 18.8, "pass"), ("minimum", 18, 17.999999, "fail"), ("maximum", 25, 24.8, "pass"), ("maximum", 25, 25, "pass"), ("maximum", 25, 25.000001, "fail")])
def test_one_sided_depth_limits_are_authoritative(catalog_admin, mode, nominal, value, expected):
    client = catalog_admin
    part = save(client, create(client), [feature(mode=mode, nominal=nominal)]).json()
    part = release(client, part).json()
    run = start(client, part).json()
    response = client.post(f"/api/runs/{run['id']}/measurements", json={"shift": "1", "featureId": part["features"][0]["id"], "value": value})
    assert response.status_code == 201, response.text
    assert response.json()["status"] == expected


def test_invalid_drafts_duplicate_parts_and_cross_revision_ids_are_rejected(catalog_admin):
    client = catalog_admin
    part = create(client)
    assert client.post("/api/admin/catalog/parts", json={"number": "TEST-NEW", "name": "Duplicate", "operation": {"code": "010", "name": "Test"}}).status_code == 409
    assert save(client, part, [feature(), feature()]).status_code == 422
    invalid = feature()
    invalid["tolerancePlus"] = 1
    assert save(client, part, [invalid]).status_code == 422
    foreign = feature()
    foreign["id"] = "f-dg1042-01"
    assert save(client, part, [foreign]).status_code == 422
    assert client.post(f"/api/admin/catalog/revisions/{part['revision']['id']}/active", json={"active": True}).status_code == 409
    prepared = save(client, part, [feature()], material="").json()
    assert release(client, prepared).status_code == 409


def test_example_catalog_only_exposes_one_active_revision(catalog_admin):
    client = catalog_admin
    operator = client.get("/api/parts?q=MF-6100").json()
    assert len(operator) == 1 and operator[0]["revision"]["code"] == "B"
    admin = client.get("/api/admin/catalog/parts/MF-6100").json()
    assert len(admin["revisions"]) == 3
    assert [r["code"] for r in admin["revisions"] if r["isActive"]] == ["B"]
    assert client.get("/api/admin/catalog/revisions/rev-mf6100-c").json()["revision"]["status"] == "draft"
    assert client.get("/api/parts/MF-6100?revisionId=rev-mf6100-c").status_code == 404


def test_admin_catalog_list_stays_a_bounded_revision_summary(catalog_admin):
    client = catalog_admin
    response = client.get("/api/admin/catalog/parts?q=MF-6100&limit=1")
    assert response.status_code == 200
    parts = response.json()
    assert len(parts) == 1
    assert parts[0]["activeRevisionCode"] == "B" and parts[0]["revisionCount"] == 3
    assert "revisions" not in parts[0]
    assert client.get("/api/admin/catalog/parts?limit=101").status_code == 422
    assert client.get("/api/admin/catalog/parts?offset=-1").status_code == 422
