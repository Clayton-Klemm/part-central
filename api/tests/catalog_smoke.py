"""Local PostgreSQL lifecycle probes; retains one labeled synthetic part/job."""
import os
import sys
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.database import engine


def must_reject(sql, values, expected=None):
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text(sql), values)
        except DBAPIError as error:
            assert expected is None or expected.lower() in str(error.orig).lower(), "Unexpected PostgreSQL rejection reason"
        else:
            raise AssertionError("PostgreSQL accepted an invalid revision change")
        finally:
            transaction.rollback()


def main():
    assert engine.dialect.name == "postgresql"
    credential = os.environ.get("ADMIN_TOKEN", "")
    assert credential, "Configure local administrator access before running this check"
    with httpx.Client(base_url="http://127.0.0.1:8000/api", timeout=15, trust_env=False) as client:
        assert client.get("/parts").status_code == 401
        assert client.post("/auth/login", json={"employeeNumber": "0101"}).status_code == 200
        catalog = client.get("/parts").json()
        assert len(catalog) >= 10
        assert client.get("/parts/MF-6100").json()["revision"]["code"] == "B"
        assert client.get("/admin/catalog/parts").status_code == 403
        assert client.post("/auth/login", json={"employeeNumber": "0000", "adminKey": credential}).status_code == 200
        example = client.get("/admin/catalog/parts/MF-6100").json()
        assert [r["code"] for r in example["revisions"] if r["isActive"]] == ["B"]
        assert {r["status"] for r in example["revisions"]} == {"draft", "released"}
        number = "VERIFY-" + uuid4().hex[:8].upper()
        created = client.post("/admin/catalog/parts", json={"number": number, "name": "Synthetic threaded block verification", "revisionCode": "A", "material": "6061-T6", "finish": "Machined", "geometryFamily": "threaded-block", "operation": {"code": "010", "name": "Finish machining", "setup": "Datum A seating face"}})
        assert created.status_code == 201, created.text
        part = created.json()
        assert client.get("/parts/" + number).status_code == 404
        body = {"material": part["material"], "finish": part["finish"], "geometryFamily": "threaded-block", "changeNote": "Synthetic lifecycle verification", "operation": {k: part["operation"][k] for k in ("code", "name", "setup")}, "features": [{"number": 1, "label": "Full thread depth", "type": "dimensional", "nominal": 18, "toleranceMinus": 0, "tolerancePlus": 0, "limitType": "minimum", "unit": "mm", "method": "Calibrated thread depth gauge", "datum": "A", "instruction": "Reference surface A and use the approved full-thread depth gauge procedure.", "sketchRef": "01", "animationKey": "thread-depth", "zone": "Threaded holes", "critical": True}]}
        body["features"].append({**body["features"][0], "number": 2, "label": "Maximum recess depth", "nominal": 25, "limitType": "maximum", "sketchRef": "02", "animationKey": "drill-depth"})
        prepared = client.put(f"/admin/catalog/revisions/{part['revision']['id']}", json=body)
        assert prepared.status_code == 200, prepared.text
        part = prepared.json()
        assert part["references"]["geometryFamily"] == "threaded-block" and part["references"]["modelAvailable"]
        edition = client.post(f"/admin/operations/{part['operation']['id']}/references", json={"expectedVersion": 0, "modelAvailable": True, "notes": "Synthetic visual-template publication"})
        assert edition.status_code == 201, edition.text
        released = client.post(f"/admin/catalog/revisions/{part['revision']['id']}/release", json={"activate": True})
        assert released.status_code == 200, released.text
        part = released.json()
        started = client.post("/runs", json={"partRevisionId": part["revision"]["id"], "operationId": part["operation"]["id"], "jobNumber": "JOB-LIBRARY-VERIFY", "inspector": "Spoofed operator", "sampleNumber": number})
        assert started.status_code == 201, started.text
        run = started.json()
        assert run["employeeNumber"] == "0000" and run["inspector"] == "Administrator"
        for value, status in [(17.999999, "fail"), (18, "pass"), (18.8, "pass")]:
            measured = client.post(f"/runs/{run['id']}/measurements", json={"shift": "1", "featureId": part["features"][0]["id"], "value": value})
            assert measured.status_code == 201 and measured.json()["status"] == status, measured.text
        for value, status in [(25.000001, "fail"), (25, "pass"), (24.8, "pass")]:
            measured = client.post(f"/runs/{run['id']}/measurements", json={"shift": "1", "featureId": part["features"][1]["id"], "value": value})
            assert measured.status_code == 201 and measured.json()["status"] == status, measured.text
        must_reject("INSERT INTO measurements (id,sequence,run_id,feature_id,value,status,notes,recorded_at,employee_number,shift) VALUES (:id,999,:run,:feature,18.8,'fail','',CURRENT_TIMESTAMP,'0000','1')", {"id": str(uuid4()), "run": run["id"], "feature": part["features"][0]["id"]}, "status disagrees")
        must_reject("INSERT INTO measurements (id,sequence,run_id,feature_id,value,status,notes,recorded_at,employee_number,shift) VALUES (:id,999,:run,:feature,24.8,'fail','',CURRENT_TIMESTAMP,'0000','1')", {"id": str(uuid4()), "run": run["id"], "feature": part["features"][1]["id"]}, "status disagrees")
        assert client.post(f"/runs/{run['id']}/complete", json={"shift": "1", "expectedSequence": 6}).status_code == 200
        cloned = client.post(f"/admin/catalog/parts/{number}/revisions", json={"code": "B", "sourceRevisionId": part["revision"]["id"], "changeNote": "Increase full-thread requirement"})
        assert cloned.status_code == 201, cloned.text
        second = cloned.json()
        body["features"][0]["nominal"] = 20
        assert client.put(f"/admin/catalog/revisions/{second['revision']['id']}", json=body).status_code == 200
        activated = client.post(f"/admin/catalog/revisions/{second['revision']['id']}/release", json={"activate": True})
        assert activated.status_code == 200, activated.text
        assert client.get("/parts/" + number).json()["revision"]["code"] == "B"
        inactive_start = client.post("/runs", json={"partRevisionId": part["revision"]["id"], "operationId": part["operation"]["id"], "jobNumber": "JOB-LIBRARY-VERIFY", "inspector": "Administrator", "sampleNumber": "INACTIVE"})
        assert inactive_start.status_code == 409
        assert client.get(f"/parts/{number}?revisionId={part['revision']['id']}").json()["features"][0]["nominal"] == 18
        assert client.get(f"/runs/{run['id']}").json()["references"] == run["references"]
        must_reject("UPDATE part_revisions SET is_active=true WHERE id=:id", {"id": part["revision"]["id"]})
        must_reject("UPDATE characteristics SET nominal=99 WHERE id=:id", {"id": part["features"][0]["id"]})
        must_reject("UPDATE part_revisions SET material='Changed' WHERE id=:id", {"id": second["revision"]["id"]})
        assert client.post(f"/admin/catalog/revisions/{second['revision']['id']}/active", json={"active": False}).status_code == 200
        assert client.get("/parts/" + number).status_code == 404
        assert client.get(f"/runs/{run['id']}").json()["status"] == "completed"
        print("PASS local employee roles, draft preparation, MIN/MAX depth, visual template, release, active uniqueness, historical preservation, and deactivation")
        print("Retained synthetic part:", number, "/ verification job JOB-LIBRARY-VERIFY")


if __name__ == "__main__":
    main()
