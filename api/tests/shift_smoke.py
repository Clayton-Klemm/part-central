"""Live PostgreSQL shift handoff and optimistic concurrency evidence.

Retains one labeled synthetic sheet; invalid SQL statements roll back.
Run inside API container: python tests/shift_smoke.py
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import httpx
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.database import engine

BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api")


def rejects(statement, parameters, reason):
    # Even an unexpectedly accepted statement must never persist in the demo.
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text(statement), parameters)
        except DBAPIError as error:
            assert reason.lower() in str(error.orig).lower(), "Unexpected database rejection reason"
        else:
            raise AssertionError("Database accepted invalid shift attribution")
        finally:
            transaction.rollback()


def main():
    assert engine.dialect.name == "postgresql", "Use PostgreSQL for the live concurrency check"
    with httpx.Client(base_url=BASE_URL, timeout=20) as first, httpx.Client(base_url=BASE_URL, timeout=20) as second:
        assert first.post("/auth/login", json={"employeeNumber": "1111"}).status_code == 200
        assert second.post("/auth/login", json={"employeeNumber": "2222"}).status_code == 200
        part = first.get("/parts/DG-1042").json()
        number = "SHIFT-VERIFY-" + uuid4().hex[:10].upper()
        response = first.post("/runs", json={"partRevisionId": part["revision"]["id"], "operationId": part["operation"]["id"], "jobNumber": number, "sampleNumber": "HANDOFF-01", "inspector": "Ignored client label"})
        assert response.status_code == 201, response.text
        run = response.json()
        path = f"/runs/{run['id']}"
        features = part["features"]
        for shift in [None, "3", "4", "071", 71, 1]:
            assert first.post(path + "/measurements", json={"featureId": features[0]["id"], "value": "12.5", "shift": shift}).status_code == 422
        initial = first.post(path + "/measurements", json={"featureId": features[0]["id"], "value": "13", "shift": "1", "expectedSequence": 0})
        assert initial.status_code == 201 and initial.json()["employeeNumber"] == "1111"
        correction = second.post(path + "/measurements", json={"featureId": features[0]["id"], "value": "12.5", "shift": "2", "expectedSequence": 1})
        assert correction.status_code == 201 and correction.json()["employeeNumber"] == "2222"
        summary = first.get("/runs", params={"summary": "true", "jobNumber": number}).json()[0]
        assert summary["employeeNumber"] == "1111" and summary["lastRecordedByEmployeeNumber"] == "2222" and summary["lastRecordedShift"] == "2"
        assert summary["lastActivityAt"] == correction.json()["recordedAt"]
        assert "measurements" not in summary
        print("PASS employee/shift handoff keeps original author, correction and exact-job summary")

        barrier = Barrier(2)
        def stale_append(client, shift):
            barrier.wait(timeout=10)
            return client.post(path + "/measurements", json={"featureId": features[1]["id"], "value": str(features[1]["nominal"]), "shift": shift, "expectedSequence": 2})
        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(stale_append, first, "1")
            b = pool.submit(stale_append, second, "71")
            pair = [a.result(), b.result()]
        assert sorted(item.status_code for item in pair) == [201, 409]
        winner = next(item.json() for item in pair if item.status_code == 201)
        assert (winner["employeeNumber"], winner["shift"]) in [("1111", "1"), ("2222", "71")]
        history = first.get(path).json()["measurements"]
        assert [item["sequence"] for item in history] == [1, 2, 3]
        assert history[0]["status"] == "fail" and history[1]["status"] == "pass"
        print("PASS two employees competing at the same sequence yield one save and one conflict; no lost event")

        sequence = 3
        for feature in features[2:]:
            saved = second.post(path + "/measurements", json={"featureId": feature["id"], "value": str(feature["nominal"]), "shift": "71", "expectedSequence": sequence})
            assert saved.status_code == 201, saved.text
            sequence += 1
        insert = """INSERT INTO measurements(id,sequence,run_id,feature_id,value,status,notes,recorded_at,employee_number,shift)
          VALUES(:id,999,:run,:feature,12.5,'pass','',CURRENT_TIMESTAMP,:employee,:shift)"""
        params = {"id": "reject-" + uuid4().hex, "run": run["id"], "feature": features[0]["id"], "employee": "1111", "shift": None}
        rejects(insert, params, "require employee and shift")
        rejects(insert, {**params, "shift": "3"}, "require employee and shift")
        rejects(insert, {**params, "shift": "4"}, "require employee and shift")
        rejects(insert, {**params, "employee": None, "shift": "1"}, "require employee and shift")
        # XXXX can never be enrolled: employees.number requires ASCII digits.
        rejects(insert, {**params, "employee": "XXXX", "shift": "1"}, "foreign key")
        rejects("UPDATE inspection_runs SET status='completed',completed_at=CURRENT_TIMESTAMP,completed_by_employee_number='1111',completed_shift='3' WHERE id=:id", {"id": run["id"]}, "completion requires employee and shift")
        rejects("UPDATE inspection_runs SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=:id", {"id": run["id"]}, "completion requires employee and shift")
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                connection.execute(text(insert), {**params, "shift": "71"})
                assert connection.scalar(text("SELECT shift FROM measurements WHERE id=:id"), params) == "71"
                connection.execute(text("UPDATE inspection_runs SET status='completed',completed_at=CURRENT_TIMESTAMP,completed_by_employee_number='1111',completed_shift='71' WHERE id=:id"), {"id": run["id"]})
                assert connection.scalar(text("SELECT completed_shift FROM inspection_runs WHERE id=:id"), {"id": run["id"]}) == "71"
            finally:
                transaction.rollback()
        print("PASS direct database writes accept weekend 71 and reject missing/retired/invalid attribution (rolled back)")

        barrier = Barrier(2)
        def complete():
            barrier.wait(timeout=10)
            return second.post(path + "/complete", json={"shift": "71", "expectedSequence": sequence})
        def append():
            barrier.wait(timeout=10)
            return first.post(path + "/measurements", json={"featureId": features[0]["id"], "value": "12.5", "shift": "1", "expectedSequence": sequence})
        with ThreadPoolExecutor(max_workers=2) as pool:
            a, b = pool.submit(complete), pool.submit(append)
            completion, appended = a.result(), b.result()
        assert sorted([completion.status_code, appended.status_code]) in [[200, 409], [201, 409]]
        if completion.status_code == 409:
            assert appended.status_code == 201
            completion = second.post(path + "/complete", json={"shift": "71", "expectedSequence": sequence + 1})
        assert completion.status_code == 200, completion.text
        completed = completion.json()
        assert completed["completedByEmployeeNumber"] == "2222" and completed["completedShift"] == "71"
        assert completed["overallStatus"] == "pass"
        assert [item["sequence"] for item in completed["measurements"]] == list(range(1, len(completed["measurements"]) + 1))
        retry = first.post(path + "/complete", json={"shift": "1"})
        assert retry.json() == completed
        rejects("UPDATE inspection_runs SET completed_shift='1' WHERE id=:id", {"id": run["id"]}, "immutable")
        rejects("UPDATE measurements SET shift='3' WHERE id=:id", {"id": initial.json()["id"]}, "append-only")
        print("PASS competing completion/append, immutable completion signer, and idempotent retry")
        print(f"Verification sheet retained: {number} / {run['id']} / {len(completed['measurements'])} events")


if __name__ == "__main__":
    main()
