"""Shift handoff, provenance, database boundary and forward migration checks."""
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.database import make_engine
from app.seed import seed
from test_inspection import start


def record(client, run, feature="f-dg1042-01", shift="1", **overrides):
    return client.post(f"/api/runs/{run['id']}/measurements", json={"featureId": feature, "value": "12.5", "shift": shift, **overrides})


@pytest.mark.parametrize("shift", [None, "", "3", "4", "day", 1, " 1", "１", "071", 71])
def test_shift_is_explicit_validated_and_not_inferred_from_clock(client, shift):
    run = start(client)
    assert record(client, run, shift=shift).status_code == 422
    assert client.post(f"/api/runs/{run['id']}/complete", json={"shift": shift}).status_code == 422
    assert client.get(f"/api/runs/{run['id']}").json()["measurements"] == []


def test_missing_shift_cannot_create_event_or_complete_sheet(client):
    run = start(client)
    assert client.post(f"/api/runs/{run['id']}/measurements", json={"featureId": "f-dg1042-01", "value": "12.5"}).status_code == 422
    assert client.post(f"/api/runs/{run['id']}/complete").status_code == 422


def test_multi_employee_handoff_records_reading_and_completion_identity(client, database):
    run = start(client, jobNumber="MULTI-DAY-001")
    first = record(client, run).json()
    assert first["employeeNumber"] == "1234" and first["shift"] == "1"
    assert client.post("/api/auth/login", json={"employeeNumber": "0456"}).status_code == 200
    second = record(client, run, shift="2", value="12.51", expectedSequence=1).json()
    assert second["employeeNumber"] == "0456" and second["shift"] == "2"
    summary = client.get("/api/runs?summary=true&jobNumber=multi-day-001").json()[0]
    assert summary["employeeNumber"] == "1234"  # original sheet creator
    assert summary["lastRecordedByEmployeeNumber"] == "0456"
    assert summary["lastRecordedShift"] == "2"
    assert summary["lastActivityAt"] == second["recordedAt"]
    assert summary["measurementCount"] == 1
    part = client.get("/api/parts/DG-1042").json()
    for feature in part["features"][1:]:
        response = record(client, run, feature["id"], "71", value=str(feature["nominal"]))
        assert response.status_code == 201, response.text
    completed = client.post(f"/api/runs/{run['id']}/complete", json={"shift": "71", "expectedSequence": 9}).json()
    assert completed["completedByEmployeeNumber"] == "0456" and completed["completedShift"] == "71"
    assert completed["lastActivityAt"] == completed["completedAt"]
    assert completed["measurements"][0]["employeeNumber"] == "1234"
    assert client.post("/api/auth/login", json={"employeeNumber": "0789"}).status_code == 200
    retry = client.post(f"/api/runs/{run['id']}/complete", json={"shift": "2"}).json()
    assert retry == completed  # retry cannot rewrite who signed off the sheet
    with pytest.raises(DBAPIError), database.begin() as session:
        session.execute(text("UPDATE inspection_runs SET completed_shift='1' WHERE id=:id"), {"id": run["id"]})


def test_employee_number_cannot_be_supplied_as_measurement_or_completion_author(client):
    run = start(client)
    assert record(client, run, employeeNumber="0000").status_code == 422
    assert client.post(f"/api/runs/{run['id']}/complete", json={"shift": "1", "employeeNumber": "0000"}).status_code == 422


@pytest.mark.parametrize("employee,shift", [(None, "1"), ("1234", None), ("1234", "3"), ("1234", "4"), ("XXXX", "1")])
def test_database_requires_valid_provenance_on_new_events(client, database, employee, shift):
    run = start(client)
    with pytest.raises(DBAPIError), database.begin() as session:
        session.execute(text("""INSERT INTO measurements
          (id,sequence,run_id,feature_id,value,status,notes,recorded_at,employee_number,shift)
          VALUES('invalid-provenance',1,:run,'f-dg1042-01',12.5,'pass','',CURRENT_TIMESTAMP,:employee,:shift)"""),
          {"run": run["id"], "employee": employee, "shift": shift})
    assert client.get(f"/api/runs/{run['id']}").json()["measurements"] == []


def test_database_requires_complete_attribution_on_completion_transition(client, database):
    run = start(client)
    part = client.get("/api/parts/DG-1042").json()
    for feature in part["features"]:
        assert record(client, run, feature["id"], value=str(feature["nominal"])).status_code == 201
    for attribution in [",completed_by_employee_number='1234',completed_shift='3'", "", ",completed_shift='1'", ",completed_by_employee_number='1234'", ",completed_by_employee_number='1234',completed_shift='4'", ",completed_by_employee_number='XXXX',completed_shift='1'"]:
        with pytest.raises(DBAPIError), database.begin() as session:
            session.execute(text("UPDATE inspection_runs SET status='completed',completed_at=CURRENT_TIMESTAMP" + attribution + " WHERE id=:id"), {"id": run["id"]})
    assert client.get(f"/api/runs/{run['id']}").json()["status"] == "draft"


def test_job_tabs_have_exact_scope_and_constant_bounded_query_count(client, database):
    first = start(client, jobNumber="SHIFT-100")
    for i in range(8):
        record(client, first, shift=("1", "2", "71")[i % 3], value=str(12.5 + i / 1000))
    second = start(client, jobNumber="SHIFT-100", sampleNumber="02")
    start(client, jobNumber="SHIFT-100-OTHER")
    queries = []
    engine = database.kw["bind"]
    def query(_connection, _cursor, statement, *_):
        if statement.lstrip().upper().startswith("SELECT"):
            queries.append(statement)
    event.listen(engine, "before_cursor_execute", query)
    try:
        result = client.get("/api/runs?summary=true&jobNumber=shift-100&limit=50").json()
    finally:
        event.remove(engine, "before_cursor_execute", query)
    assert [item["id"] for item in result] == [second["id"], first["id"]]
    assert len(queries) <= 3  # authenticated identity + page + one aggregate
    assert "measurements" not in result[0] and "references" not in result[0]
    assert result[0]["lastRecordedShift"] is None
    assert result[1]["lastRecordedShift"] == "2" and result[1]["measurementCount"] == 1
    assert client.get("/api/runs?summary=true&jobNumber=SHIFT-%").json() == []


def test_shift_migration_preserves_old_completed_records_and_never_guesses_provenance(tmp_path, monkeypatch):
    url = "sqlite:///" + (tmp_path / "legacy-shifts.db").as_posix()
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0007_geometric_magnitudes")
    engine = make_engine(url)
    with Session(engine) as session, session.begin():
        seed(session)
        session.execute(text("INSERT INTO jobs(id,number,created_at) VALUES('old-job','LEGACY-SHIFT-001',CURRENT_TIMESTAMP)"))
        session.execute(text("""INSERT INTO inspection_runs(id,revision_id,operation_id,job_id,references_snapshot,inspector,lot_number,sample_number,status,created_at)
          VALUES('old-run','rev-dg1042-c','op-dg1042-030','old-job','{}','Historical inspector','LOT-OLD','01','draft',CURRENT_TIMESTAMP)"""))
        session.execute(text("""INSERT INTO measurements(id,sequence,run_id,feature_id,value,status,notes,recorded_at)
          SELECT id,number,'old-run',id,nominal,'pass','Historical note',CURRENT_TIMESTAMP FROM characteristics WHERE operation_id='op-dg1042-030'"""))
        session.execute(text("UPDATE inspection_runs SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id='old-run'"))
    with engine.connect() as connection:
        before = connection.execute(text("SELECT id,sequence,value,status,notes,recorded_at,employee_number FROM measurements ORDER BY sequence")).all()
        original = connection.execute(text("SELECT completed_at,references_snapshot FROM inspection_runs WHERE id='old-run'")).one()
    command.upgrade(config, "head")
    with engine.connect() as connection:
        after = connection.execute(text("SELECT id,sequence,value,status,notes,recorded_at,employee_number FROM measurements ORDER BY sequence")).all()
        assert before == after
        row = connection.execute(text("SELECT completed_at,references_snapshot,completed_shift,completed_by_employee_number FROM inspection_runs WHERE id='old-run'")).one()
        assert row[:2] == original and row[2:] == (None, None)
        assert connection.scalar(text("SELECT count(*) FROM measurements WHERE shift IS NOT NULL")) == 0
        assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
    for sql in ["UPDATE measurements SET shift='1' WHERE run_id='old-run'", "UPDATE inspection_runs SET completed_shift='1',completed_by_employee_number='1234' WHERE id='old-run'"]:
        with pytest.raises(DBAPIError), engine.begin() as connection:
            connection.execute(text(sql))
    engine.dispose()
