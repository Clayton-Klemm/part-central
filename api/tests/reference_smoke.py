"""Targeted live reference checks. Keeps labeled editions; never deletes history.

Run inside the API container after benchmark traffic has stopped. Credentials
are read only from its environment and are never included in output.
"""
import hashlib
import os
import struct
import sys
import zlib
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.database import engine
from app.references import storage_root


def png_chunk(kind, value):
    return struct.pack(">I", len(value)) + kind + value + struct.pack(">I", zlib.crc32(kind + value))


def rejected_sql(statement, parameters):
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text(statement), parameters)
        except DBAPIError as error:
            assert "append-only" in str(error.orig).lower(), "Unexpected database rejection reason"
        else:
            raise AssertionError("Database accepted an invalid reference mutation")
        finally:
            transaction.rollback()


def main():
    assert engine.dialect.name == "postgresql", "Run this check against PostgreSQL"
    credential = os.environ.get("ADMIN_TOKEN", "")
    assert credential, "Configure an administrator credential before this check"
    headers = {"Authorization": "Bearer " + credential}
    operation = "op-dg3105-030"
    path = f"/admin/operations/{operation}"
    image = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + png_chunk(b"IDAT", zlib.compress(b"\x00\x44\xaa\x88")) + png_chunk(b"IEND", b"")
    with httpx.Client(base_url="http://127.0.0.1:8000/api", timeout=15) as client:
        assert client.get(path + "/references").status_code == 401
        assert client.get(path + "/references", headers={"Authorization": "Bearer invalid"}).status_code == 401
        assert client.get("/admin/status").json()["configured"] is True
        assert client.post("/auth/login", json={"employeeNumber": "0000", "adminKey": credential}).status_code == 200
        baseline_response = client.get(path + "/references", headers=headers)
        assert baseline_response.status_code == 200, baseline_response.status_code
        baseline = baseline_response.json()
        assert baseline["sketch"] and baseline["modelAvailable"]
        part = client.get("/parts/DG-3105").json()
        run_response = client.post("/runs", json={"partRevisionId": part["revision"]["id"], "operationId": operation, "jobNumber": "JOB-REFERENCE-VERIFICATION", "lotNumber": "", "inspector": "Administrator integration verification", "sampleNumber": "REF-" + uuid4().hex[:8]})
        assert run_response.status_code == 201, run_response.status_code
        run = run_response.json()
        uploaded = client.post(path + "/assets", params={"kind": "diagram", "filename": "Reference upload verification.png"}, content=image, headers={**headers, "Content-Type": "image/png"})
        assert uploaded.status_code == 201, uploaded.status_code
        asset = uploaded.json()
        downloaded = client.get(asset["url"].removeprefix("/api"))
        assert downloaded.status_code == 200
        assert downloaded.headers["content-type"] == "image/png"
        assert "immutable" in downloaded.headers["cache-control"]
        assert hashlib.sha256(downloaded.content).hexdigest() == asset["sha256"]
        assert downloaded.content == image
        body = {"expectedVersion": baseline["version"], "sketchAssetId": baseline["sketch"]["id"], "diagramAssetId": asset["id"], "modelAvailable": True, "notes": "Administrator integration check: uploaded PNG verified; built-in sketch and 3D guide retained."}
        published = client.post(path + "/references", json=body, headers=headers)
        assert published.status_code == 201, published.status_code
        edition = published.json()
        assert edition["diagram"]["id"] == asset["id"]
        assert edition["sketch"] == baseline["sketch"]
        assert edition["modelAvailable"] is True
        assert client.post(path + "/references", json=body, headers=headers).status_code == 409
        assert client.get(f"/runs/{run['id']}").json()["references"] == run["references"] == baseline
        for sql in ["UPDATE reference_assets SET name='Invalid rewrite' WHERE id=:id", "DELETE FROM reference_assets WHERE id=:id"]:
            rejected_sql(sql, {"id": asset["id"]})
        for sql in ["UPDATE operation_reference_versions SET notes='Invalid rewrite' WHERE id=:id", "DELETE FROM operation_reference_versions WHERE id=:id"]:
            rejected_sql(sql, {"id": edition["id"]})
        # Restore only the original visual selection via another immutable
        # edition. The uploaded file and verification edition remain available.
        body.update(expectedVersion=edition["version"], diagramAssetId=baseline["diagram"]["id"] if baseline["diagram"] else None, notes="Administrator integration verified. Original visual selection retained; historical upload verification remains available.")
        restored = client.post(path + "/references", json=body, headers=headers)
        assert restored.status_code == 201, restored.status_code
        current = restored.json()
        assert current["sketch"] == baseline["sketch"]
        assert current["diagram"] == baseline["diagram"]
        assert current["modelAvailable"] is True
        assert client.get("/parts/DG-3105").json()["references"] == current
        root = storage_root()
        assert os.access(root, os.W_OK), "The asset volume is not writable"
        assert root.stat().st_uid == 10001 and os.getuid() == 10001, "Asset ownership differs from the unprivileged API user"
        print("PASS live administrator authorization and immutable PNG upload/read/checksum")
        print("PASS PostgreSQL asset/edition append-only guards; invalid SQL rolled back")
        print("PASS stale publication rejection and earlier inspection reference pinning")
        print("PASS persistent asset volume writable by unprivileged uid10001")
        print(f"DG-3105 current reference version: {current['version']}; built-in sketch and 3D retained; original diagram selection restored")
        print(f"Retained verification inspection: {run['id']}")


if __name__ == "__main__":
    main()
