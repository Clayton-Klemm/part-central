import json
from copy import deepcopy

from sqlalchemy import text

from app.seed import DATA_PATH, seed
from test_catalog import catalog_admin


def test_reseeding_retains_business_revision_even_when_fixture_uses_different_ids(client, database, tmp_path):
    catalog = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    existing = next(part for part in catalog["parts"] if part["number"] == "RD-4200")
    replacement = deepcopy(existing)
    replacement["id"] = "fixture-alternate-master"
    replacement["revision"]["id"] = "fixture-alternate-revision"
    replacement["operation"]["id"] = "fixture-alternate-operation"
    replacement["operation"]["sketchId"] = "fixture-alternate-sketch"
    replacement["material"] = "Must not overwrite existing material"
    replacement["features"][0]["nominal"] = 999
    fixture = tmp_path / "alternate-ids.json"
    fixture.write_text(json.dumps({"parts": [replacement]}), encoding="utf-8")
    before = client.get("/api/parts/RD-4200").json()
    with database.begin() as session:
        seed(session, fixture)
        seed(session, fixture)
        assert session.scalar(text("SELECT count(*) FROM part_revisions WHERE id='fixture-alternate-revision'")) == 0
    assert client.get("/api/parts/RD-4200").json() == before


def test_fixture_does_not_replace_an_admin_authored_revision_code_or_activation(catalog_admin, database, tmp_path):
    client = catalog_admin
    source = client.get("/api/parts/MF-6100").json()
    clone = client.post("/api/admin/catalog/parts/MF-6100/revisions", json={"code": "SEED-COLLISION", "sourceRevisionId": source["revision"]["id"], "changeNote": "Administrator authored revision must survive reseeding"}).json()
    changed = deepcopy(clone["features"])
    changed[0]["nominal"] = 19
    prepared = client.put(f"/api/admin/catalog/revisions/{clone['revision']['id']}", json={"material": "Administrator material", "finish": clone["finish"], "geometryFamily": clone["revision"]["geometryFamily"], "changeNote": "Controlled authored requirements", "operation": {key: clone["operation"][key] for key in ("code", "name", "setup")}, "features": changed})
    assert prepared.status_code == 200, prepared.text
    activated = client.post(f"/api/admin/catalog/revisions/{clone['revision']['id']}/release", json={"activate": True})
    assert activated.status_code == 200, activated.text
    before = client.get("/api/parts/MF-6100").json()
    replacement = deepcopy(next(part for part in json.loads(DATA_PATH.read_text(encoding="utf-8"))["parts"] if part["number"] == "MF-6100"))
    replacement["revision"].update(id="canonical-seed-collision", code="SEED-COLLISION")
    replacement["operation"]["id"] = "canonical-seed-operation"
    fixture = tmp_path / "business-key-collision.json"
    fixture.write_text(json.dumps({"parts": [replacement]}), encoding="utf-8")
    with database.begin() as session:
        seed(session, fixture)
        seed(session)  # original B fixture must also preserve the authored active revision
        assert session.scalar(text("SELECT count(*) FROM part_revisions WHERE id='canonical-seed-collision'")) == 0
    assert client.get("/api/parts/MF-6100").json() == before
