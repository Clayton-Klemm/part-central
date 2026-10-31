from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.models import Measurement, PartRevision
from app.seed import seed


def start(client, **overrides):
    payload = {
        "partRevisionId": "rev-dg1042-c", "operationId": "op-dg1042-030",
        "jobNumber": "JOB-TEST-001", "inspector": "Taylor Morgan", "lotNumber": "LOT-2610-014", "sampleNumber": "01",
    }
    payload.update(overrides)
    response = client.post("/api/runs", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def measure(client, run, value, feature_id="f-dg1042-01"):
    return client.post(f"/api/runs/{run['id']}/measurements", json={"shift": "1", "featureId": feature_id, "value": value})


def test_master_data_and_seed_idempotency(client, database):
    with database.begin() as session:
        seed(session)
        assert len(session.scalars(select(PartRevision)).all()) >= 3
    assert client.get("/api/health").json()["status"] == "ok"
    parts = client.get("/api/parts").json()
    assert len(parts) >= 3
    detail = client.get("/api/parts/dg-1042").json()
    assert detail["revision"]["code"] == "C"
    assert len(detail["features"]) == 8
    assert detail["features"][1]["animationKey"] == "ramp-height"
    assert client.get("/api/parts/unknown").status_code == 404


@pytest.mark.parametrize("value,expected", [("12.475", "pass"), ("12.525", "pass"), ("12.474999", "fail"), ("12.525001", "fail")])
def test_exact_decimal_tolerance_boundaries(client, database, value, expected):
    run = start(client)
    response = measure(client, run, value)
    assert response.status_code == 201
    assert response.json()["status"] == expected
    with database() as session:
        stored = session.scalar(select(Measurement).where(Measurement.run_id == run["id"]))
        assert stored.value == Decimal(value)


def test_wrong_revision_and_wrong_feature_are_rejected(client):
    response = client.post("/api/runs", json={"partRevisionId": "rev-dg1042-c", "operationId": "op-dg2080-030", "jobNumber": "JOB-TEST-001", "inspector": "A", "lotNumber": "L", "sampleNumber": "01"})
    assert response.status_code == 422
    run = start(client)
    assert measure(client, run, "12.5", "f-dg2080-01").status_code == 422
    assert measure(client, run, "12.5", "unknown").status_code == 422


@pytest.mark.parametrize("value", ["NaN", "Infinity", "12.5000001", "1000000000", ""])
def test_invalid_measurements_are_rejected(client, value):
    assert measure(client, start(client), value).status_code == 422


def test_completion_requires_all_features_and_locks_history(client, database):
    run = start(client)
    path = f"/api/runs/{run['id']}"
    assert client.post(path + "/complete", json={"shift": "1"}).status_code == 409
    part = client.get("/api/parts/DG-1042").json()
    first = measure(client, run, "13.0").json()
    assert first["status"] == "fail"
    for feature in part["features"]:
        response = measure(client, run, str(feature["nominal"]), feature["id"])
        assert response.status_code == 201, response.text
    response = client.post(path + "/complete", json={"shift": "1"})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] == "completed"
    assert result["overallStatus"] == "pass"
    assert len(result["measurements"]) == 9
    assert result["measurements"][0]["status"] == "fail"
    assert result["measurements"][1]["sequence"] == 2
    assert measure(client, run, "12.5").status_code == 409
    assert client.post(path + "/complete", json={"shift": "1"}).status_code == 200
    assert client.get(path).json()["completedAt"]
    with pytest.raises(IntegrityError), database.begin() as session:
        session.execute(text("UPDATE inspection_runs SET inspector='Rewritten' WHERE id=:id"), {"id": run["id"]})


def test_failed_run_retains_failed_disposition(client):
    run = start(client)
    part = client.get("/api/parts/DG-1042").json()
    for feature in part["features"]:
        value = "13" if feature["number"] == 1 else str(feature["nominal"])
        assert measure(client, run, value, feature["id"]).status_code == 201
    assert client.post(f"/api/runs/{run['id']}/complete", json={"shift": "1"}).json()["overallStatus"] == "fail"


def test_released_requirements_and_measurement_events_cannot_be_rewritten(client, database):
    run = start(client)
    event = measure(client, run, "12.5").json()
    for sql, params in [
        ("UPDATE characteristics SET nominal=99 WHERE id='f-dg1042-01'", {}),
        ("DELETE FROM characteristics WHERE id='f-dg1042-01'", {}),
        ("UPDATE part_revisions SET material='Changed steel' WHERE id='rev-dg1042-c'", {}),
        ("UPDATE feature_guides SET animation_key='bad' WHERE id='guide-f-dg1042-01'", {}),
        ("UPDATE measurements SET value=99 WHERE id=:id", {"id": event["id"]}),
        ("DELETE FROM measurements WHERE id=:id", {"id": event["id"]}),
    ]:
        with pytest.raises(IntegrityError), database.begin() as session:
            session.execute(text(sql), params)


def test_unknown_runs_and_blank_inspector(client):
    assert client.get("/api/runs/missing").status_code == 404
    assert client.post("/api/runs/missing/complete", json={"shift": "1"}).status_code == 404
    response = client.post("/api/runs", json={"partRevisionId": "rev-dg1042-c", "operationId": "op-dg1042-030", "jobNumber": "JOB-TEST-001", "inspector": "   ", "lotNumber": "L", "sampleNumber": "01"})
    assert response.status_code == 422


def test_database_rejects_cross_operation_events_and_incomplete_completion(client, database):
    run = start(client)
    for sql in [
        "INSERT INTO measurements (id, sequence, run_id, feature_id, value, status, notes, recorded_at) VALUES ('bad-event', 1, :id, 'f-dg2080-01', 12.5, 'pass', '', CURRENT_TIMESTAMP)",
        "UPDATE inspection_runs SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE id=:id",
    ]:
        with pytest.raises(IntegrityError), database.begin() as session:
            session.execute(text(sql), {"id": run["id"]})


@pytest.mark.parametrize("sample", ["01", "A1", "first-article", "a" * 40])
def test_sample_identifiers_preserve_text(client, sample):
    run = start(client, sampleNumber=sample)
    assert run["sampleNumber"] == sample
    assert client.get(f"/api/runs/{run['id']}").json()["sampleNumber"] == sample


@pytest.mark.parametrize("sample", ["", "   ", "a" * 41, 1])
def test_invalid_sample_identifiers(client, sample):
    response = client.post("/api/runs", json={
        "partRevisionId": "rev-dg1042-c", "operationId": "op-dg1042-030",
        "jobNumber": "JOB-TEST-001", "inspector": "Taylor", "lotNumber": "L", "sampleNumber": sample,
    })
    assert response.status_code == 422


def test_shared_run_list_is_newest_first_bounded_and_filterable(client, monkeypatch):
    timestamps = iter(datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=index) for index in range(100))
    class IncreasingClock:
        @staticmethod
        def now(_timezone):
            return next(timestamps)
    # Request arrival and wall-clock ordering are separate assumptions. Give
    # this newest-first test strictly increasing, deterministic creation times.
    monkeypatch.setattr("app.models.datetime", IncreasingClock)
    assert client.get("/api/runs").json() == []
    first = start(client, sampleNumber="01")
    event = measure(client, first, "12.5").json()
    other = client.get("/api/parts/DG-2080").json()
    second = start(client, partRevisionId=other["revision"]["id"], operationId=other["operation"]["id"], sampleNumber="A1")
    third = start(client, sampleNumber="03")
    assert first["createdAt"] < second["createdAt"] < third["createdAt"]
    response = client.get("/api/runs")
    assert response.status_code == 200
    runs = response.json()
    assert [run["id"] for run in runs] == [third["id"], second["id"], first["id"]], {
        "actual": [(run["id"], run["createdAt"]) for run in runs],
        "created": [(run["id"], run["createdAt"]) for run in (first, second, third)],
    }
    assert runs[2]["measurements"][0]["id"] == event["id"]
    assert [run["id"] for run in client.get("/api/runs?limit=2").json()] == [third["id"], second["id"]]
    filtered = client.get("/api/runs", params={"partRevisionId": first["partRevisionId"]}).json()
    assert [run["id"] for run in filtered] == [third["id"], first["id"]]
    assert client.get("/api/runs?partRevisionId=missing").json() == []


def test_shared_run_list_uses_stable_id_tie_break_for_equal_creation_times(client, monkeypatch):
    instant = datetime(2026, 1, 1, tzinfo=timezone.utc)
    class FixedClock:
        @staticmethod
        def now(_timezone):
            return instant
    monkeypatch.setattr("app.models.datetime", FixedClock)
    created = [start(client, sampleNumber=str(index)) for index in range(3)]
    assert len({run["createdAt"] for run in created}) == 1
    expected = sorted((run["id"] for run in created), reverse=True)
    assert [run["id"] for run in client.get("/api/runs").json()] == expected
    assert [run["id"] for run in client.get("/api/runs?limit=2").json()] == expected[:2]
    assert [run["id"] for run in client.get("/api/runs?limit=2&offset=1").json()] == expected[1:]


@pytest.mark.parametrize("limit", [0, -1, 101, "many"])
def test_shared_run_list_rejects_invalid_limits(client, limit):
    assert client.get("/api/runs", params={"limit": limit}).status_code == 422

