import base64
import struct
import zlib

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.references import MAX_ASSET_BYTES
from app.models import Operation, PartRevision


OPERATION = "op-dg1042-030"
ROOT = f"/api/admin/operations/{OPERATION}"
def png_chunk(kind, content):
    return struct.pack(">I", len(content)) + kind + content + struct.pack(">I", zlib.crc32(kind + content))


PNG = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + png_chunk(b"IDAT", zlib.compress(b"\x00\x44\xaa\x88")) + png_chunk(b"IEND", b"")
PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
JPEG = base64.b64decode("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==")


@pytest.fixture
def admin(monkeypatch, tmp_path):
    monkeypatch.setenv("ADMIN_TOKEN", "test-only-administrator-credential")
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "reference-assets"))
    return {"Authorization": "Bearer test-only-administrator-credential"}


def upload(client, admin, kind="sketch", operation=OPERATION, data=PNG, mime="image/png", name="basic-op-sketch.png"):
    return client.post(f"/api/admin/operations/{operation}/assets", params={"kind": kind, "filename": name}, content=data, headers={**admin, "Content-Type": mime})


def publish(client, admin, **updates):
    body = {"expectedVersion": 0, "sketchAssetId": None, "diagramAssetId": None, "modelAvailable": False, "notes": "Reference edition for testing"}
    body.update(updates)
    return client.post(ROOT + "/references", json=body, headers=admin)


def start(client, sample="01"):
    response = client.post("/api/runs", json={"partRevisionId": "rev-dg1042-c", "operationId": OPERATION, "jobNumber": "JOB-REF-001", "inspector": "Reference tester", "lotNumber": "LOT-REF", "sampleNumber": sample})
    assert response.status_code == 201, response.text
    return response.json()


def test_admin_endpoints_are_server_protected_and_disabled_without_credential(client, monkeypatch, admin):
    assert client.get("/api/admin/status").json() == {"configured": True}
    assert client.get(ROOT + "/references").status_code == 403
    assert client.get(ROOT + "/references", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert upload(client, {}).status_code == 403
    monkeypatch.delenv("ADMIN_TOKEN")
    assert client.get("/api/admin/status").json() == {"configured": False}
    response = client.get(ROOT + "/references", headers=admin)
    assert response.status_code == 503
    assert "test-only-administrator-credential" not in response.text


def test_upload_is_immutable_scoped_and_served_with_correct_headers(client, admin, database):
    response = upload(client, admin, name="../../machine\\drawing.png")
    assert response.status_code == 201, response.text
    asset = response.json()
    assert asset["name"] == "drawing.png"
    assert len(asset["sha256"]) == 64
    downloaded = client.get(asset["url"])
    assert downloaded.status_code == 200
    assert downloaded.content == PNG
    assert downloaded.headers["content-type"] == "image/png"
    assert "immutable" in downloaded.headers["cache-control"]
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in downloaded.headers["content-security-policy"]
    assert client.get("/api/reference-assets/unknown").status_code == 404
    for sql in ["UPDATE reference_assets SET name='Changed' WHERE id=:id", "DELETE FROM reference_assets WHERE id=:id"]:
        with pytest.raises(IntegrityError), database.begin() as session:
            session.execute(text(sql), {"id": asset["id"]})


@pytest.mark.parametrize("data,mime", [(b"<svg><script>alert(1)</script></svg>", "image/svg+xml"), (PNG, "text/html"), (b"%PDF-1.4 incomplete", "application/pdf"), (b"not a png", "image/png"), (b"\x89PNG\r\n\x1a\nrandom-junk", "image/png"), (PNG[:-5], "image/png"), (PNG + b"<script>junk</script>", "image/png"), (b"\xff\xd8\xffrandom-junk\xff\xd9", "image/jpeg")])
def test_upload_rejects_executable_mismatched_and_invalid_formats(client, admin, data, mime):
    assert upload(client, admin, data=data, mime=mime).status_code == 415


def test_upload_rejects_empty_oversized_and_missing_operation(client, admin):
    assert upload(client, admin, data=b"").status_code in {413, 422}
    response = client.post(ROOT + "/assets?kind=sketch&filename=large.png", content=PNG, headers={**admin, "Content-Type": "image/png", "Content-Length": str(MAX_ASSET_BYTES + 1)})
    assert response.status_code == 413
    assert upload(client, admin, data=PNG + b"x" * MAX_ASSET_BYTES).status_code == 413
    assert upload(client, admin, operation="unknown").status_code == 404


def test_valid_jpeg_container_round_trips_as_an_image(client, admin):
    response = upload(client, admin, kind="diagram", data=JPEG, mime="image/jpeg", name="diagram.jpg")
    assert response.status_code == 201, response.text
    downloaded = client.get(response.json()["url"])
    assert downloaded.content == JPEG
    assert downloaded.headers["content-type"] == "image/jpeg"


def test_sketch_only_and_no_visual_editions_remain_valid(client, admin):
    asset = upload(client, admin, data=PDF, mime="application/pdf", name="approved-op.pdf").json()
    first = publish(client, admin, sketchAssetId=asset["id"])
    assert first.status_code == 201, first.text
    assert first.json()["version"] == 1
    assert first.json()["sketch"]["mediaType"] == "application/pdf"
    assert first.json()["diagram"] is None
    assert first.json()["modelAvailable"] is False
    assert client.get("/api/parts/DG-1042").json()["references"] == first.json()
    empty = publish(client, admin, expectedVersion=1)
    assert empty.status_code == 201
    assert empty.json()["version"] == 2
    assert empty.json()["sketch"] is None
    assert empty.json()["diagram"] is None
    assert empty.json()["modelAvailable"] is False
    part = client.get("/api/parts/DG-1042").json()
    assert len(part["features"]) == 8
    assert start(client)["references"] == empty.json()


def test_publication_preserves_old_inspection_references_and_handles_conflicts(client, admin, database):
    before = start(client)
    baseline = before["references"]
    assert baseline["version"] == 0
    assert baseline["sketch"]["mediaType"] == "application/x-partcentral-sketch"
    diagram = upload(client, admin, kind="diagram").json()
    edition = publish(client, admin, sketchAssetId=baseline["sketch"]["id"], diagramAssetId=diagram["id"], modelAvailable=True)
    assert edition.status_code == 201, edition.text
    current = edition.json()
    assert current["sketch"] == baseline["sketch"]
    assert current["diagram"]["id"] == diagram["id"]
    assert client.get(f"/api/runs/{before['id']}").json()["references"] == baseline
    assert start(client, "02")["references"] == current
    assert publish(client, admin).status_code == 409
    assert client.get(ROOT + "/references", headers=admin).json() == current
    for sql in ["UPDATE operation_reference_versions SET notes='Changed' WHERE id=:id", "DELETE FROM operation_reference_versions WHERE id=:id"]:
        with pytest.raises(IntegrityError), database.begin() as session:
            session.execute(text(sql), {"id": current["id"]})


def test_wrong_asset_type_and_operation_are_rejected(client, admin):
    sketch = upload(client, admin).json()
    assert publish(client, admin, diagramAssetId=sketch["id"]).status_code == 422
    other = upload(client, admin, operation="op-dg2080-030").json()
    assert publish(client, admin, sketchAssetId=other["id"]).status_code == 422
    assert publish(client, admin, sketchAssetId="missing").status_code == 422
    assert client.post("/api/admin/operations/unknown/references", json={"expectedVersion": 0}, headers=admin).status_code == 404


def test_operation_without_visuals_cannot_inherit_an_unrelated_gear_model(client, admin, database):
    with database.begin() as session:
        session.add(PartRevision(id="rev-bare-test", part_id="p-dg1042", code="BARE-TEST", status="draft", released_at=None, material="Test material", finish="Test finish"))
        session.flush()
        session.add(Operation(id="op-bare-test", revision_id="rev-bare-test", code="010", name="Manual inspection", setup="Follow the existing work instruction", sketch_id=None))
    path = "/api/admin/operations/op-bare-test/references"
    baseline = client.get(path, headers=admin).json()
    assert baseline["sketch"] is None
    assert baseline["diagram"] is None
    assert baseline["modelAvailable"] is False
    assert client.post(path, json={"expectedVersion": 0, "modelAvailable": True}, headers=admin).status_code == 422
    assert client.post(path, json={"expectedVersion": 0}, headers=admin).status_code == 201


def test_direct_database_reference_scope_and_version_guards(client, admin, database):
    other = upload(client, admin, operation="op-dg2080-030").json()
    for version, asset_id in [(2, None), (1, other["id"])]:
        with pytest.raises(IntegrityError), database.begin() as session:
            session.execute(text("""INSERT INTO operation_reference_versions
                (id,operation_id,version,sketch_asset_id,model_available,notes,created_at)
                VALUES (:id,:operation_id,:version,:asset_id,0,'Invalid edition',CURRENT_TIMESTAMP)"""),
                {"id": f"invalid-edition-{version}", "operation_id": OPERATION, "version": version, "asset_id": asset_id})

