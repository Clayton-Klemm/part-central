"""Non-destructive live PostgreSQL checks; retains one named verification run.

Inside the running API container:
    python tests/postgres_smoke.py

This intentionally exercises live persistence. Invalid direct SQL is rolled
back, and no records, volumes, or schemas are deleted or reset.
"""
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import httpx
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.database import engine, SessionLocal
from app.seed import seed


BASE_URL = "http://127.0.0.1:8000/api"


def reject_sql(statement, parameters, expected):
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text(statement), parameters)
        except DBAPIError as error:
            assert expected.lower() in str(error.orig).lower(), "Unexpected database rejection reason"
        else:
            raise AssertionError("Database accepted an invalid change")
        finally:
            transaction.rollback()


def main():
    assert engine.dialect.name == "postgresql", "Run this smoke check against PostgreSQL"
    with engine.connect() as connection:
        initial_count = connection.scalar(text("SELECT count(*) FROM characteristics"))
    with SessionLocal.begin() as session:
        seed(session)
    with SessionLocal.begin() as session:
        seed(session)
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM characteristics")) == initial_count
    print("PASS PostgreSQL reseeding leaves released definitions unchanged")

    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert client.post("/auth/login", json={"employeeNumber": "1234"}).status_code == 200
        session_cookies = dict(client.cookies)
        catalog = client.get("/parts").json()
        assert len(catalog) >= 3
        part = client.get("/parts/DG-1042").json()
        other = client.get("/parts/DG-2080").json()
        identifier = "PG-VERIFY-" + uuid4().hex[:8]
        payload = {
            "partRevisionId": part["revision"]["id"], "operationId": part["operation"]["id"],
            "jobNumber": "JOB-PG-VERIFY", "inspector": "Automated demo verification",
            "lotNumber": "TECH-DEMO-VERIFY-" + datetime.now(timezone.utc).strftime("%Y%m%d"),
            "sampleNumber": identifier,
        }
        response = client.post("/runs", json=payload)
        assert response.status_code == 201, "Run creation failed"
        run = response.json()
        assert run["sampleNumber"] == identifier
        path = f"/runs/{run['id']}"
        assert client.post("/runs", json={**payload, "operationId": other["operation"]["id"]}).status_code == 422
        assert client.post(path + "/measurements", json={"shift": "1", "featureId": other["features"][0]["id"], "value": "12.5"}).status_code == 422
        assert client.post(path + "/complete", json={"shift": "1"}).status_code == 409
        print("PASS revision/operation validation and incomplete-run rejection")

        feature = part["features"][0]
        nominal = Decimal(str(feature["nominal"]))
        lower = nominal - Decimal(str(feature["toleranceMinus"]))
        upper = nominal + Decimal(str(feature["tolerancePlus"]))
        for value, status in ((lower, "pass"), (upper, "pass"), (lower - Decimal("0.000001"), "fail"), (upper + Decimal("0.000001"), "fail"), (nominal, "pass")):
            result = client.post(path + "/measurements", json={"shift": "1", "featureId": feature["id"], "value": str(value), "notes": "Live PostgreSQL boundary/correction verification"})
            assert result.status_code == 201
            assert result.json()["status"] == status
        for item in part["features"][1:]:
            result = client.post(path + "/measurements", json={"shift": "1", "featureId": item["id"], "value": str(item["nominal"]), "notes": "Live PostgreSQL nominal verification"})
            assert result.status_code == 201 and result.json()["status"] == "pass"
        print("PASS exact inclusive boundaries and append-only correction history")

        rejected_event = "rejected-" + uuid4().hex
        reject_sql("UPDATE characteristics SET nominal=99 WHERE id=:id", {"id": feature["id"]}, "Released definitions are immutable")
        reject_sql("UPDATE part_revisions SET material='Uncontrolled edit' WHERE id=:id", {"id": part["revision"]["id"]}, "Released revisions are immutable")
        first_event = client.get(path).json()["measurements"][0]
        reject_sql("UPDATE measurements SET value=99 WHERE id=:id", {"id": first_event["id"]}, "append-only")
        reject_sql("DELETE FROM measurements WHERE id=:id", {"id": first_event["id"]}, "append-only")
        reject_sql("""
            INSERT INTO measurements (id, sequence, run_id, feature_id, value, status, notes, recorded_at, employee_number, shift)
            VALUES (:id, 999, :run, :feature, 12.5, 'pass', '', CURRENT_TIMESTAMP, '1234', '1')
        """, {"id": rejected_event, "run": run["id"], "feature": other["features"][0]["id"]}, "another operation")
        reject_sql("""
            INSERT INTO measurements (id, sequence, run_id, feature_id, value, status, notes, recorded_at, employee_number, shift)
            VALUES (:id, 999, :run, :feature, 12.5, 'fail', '', CURRENT_TIMESTAMP, '1234', '1')
        """, {"id": rejected_event, "run": run["id"], "feature": feature["id"]}, "status disagrees")
        print("PASS released-definition, append-only, cross-operation and tolerance database guards (rolled back)")

        def append(_):
            return httpx.post(BASE_URL + path + "/measurements", json={"shift": "1", "featureId": feature["id"], "value": str(nominal), "notes": "Concurrent append verification"}, cookies=session_cookies, timeout=15)
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(append, range(4)))
        assert all(response.status_code == 201 for response in responses), "Concurrent append failed"
        current = client.get(path).json()
        sequences = [item["sequence"] for item in current["measurements"]]
        assert sequences == list(range(1, 17)), "Concurrent sequence allocation lost or duplicated an event"
        print("PASS four concurrent appends serialize without lost readings")

        barrier = Barrier(2)
        def complete_race():
            barrier.wait(timeout=10)
            return httpx.post(BASE_URL + path + "/complete", json={"shift": "1"}, cookies=session_cookies, timeout=15)
        def append_race():
            barrier.wait(timeout=10)
            return append(None)
        with ThreadPoolExecutor(max_workers=2) as pool:
            completion = pool.submit(complete_race)
            append_result = pool.submit(append_race)
            assert completion.result().status_code == 200
            assert append_result.result().status_code in (201, 409)
        completed = client.get(path).json()
        assert completed["status"] == "completed" and completed["overallStatus"] == "pass"
        assert len(completed["measurements"]) in (16, 17)
        assert sum(item["status"] == "fail" for item in completed["measurements"]) == 2
        assert client.post(path + "/measurements", json={"shift": "1", "featureId": feature["id"], "value": "12.5"}).status_code == 409
        assert client.post(path + "/complete", json={"shift": "1"}).json()["completedAt"] == completed["completedAt"]
        reject_sql("UPDATE inspection_runs SET inspector='Overwrite' WHERE id=:id", {"id": run["id"]}, "immutable")
        reject_sql("""
            INSERT INTO measurements (id, sequence, run_id, feature_id, value, status, notes, recorded_at, employee_number, shift)
            VALUES (:id, 999, :run, :feature, 12.5, 'pass', '', CURRENT_TIMESTAMP, '1234', '1')
        """, {"id": rejected_event, "run": run["id"], "feature": feature["id"]}, "must be a draft")
        print("PASS competing completion/append, locked final record, and idempotent completion")
        print(f"Verification run retained: {run['id']} / sample {identifier} / {len(completed['measurements'])} events")


if __name__ == "__main__":
    main()

