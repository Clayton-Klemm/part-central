"""Weekend shift writes, historical shift preservation and migration guards."""
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker

from app.database import get_db, make_engine
from app.main import app
from app.seed import seed
from test_inspection import start


def test_weekend_shift_is_saved_read_and_signed_off_exactly(client, database):
    part = client.get("/api/parts/AF-5400").json()
    run = start(client, partRevisionId=part["revision"]["id"], operationId=part["operation"]["id"], jobNumber="WEEKEND-71-001")
    for index, feature in enumerate(part["features"]):
        # The screenshot's .04 is exact maximum-inclusive runout acceptance.
        value = ".04" if feature["animationKey"] == "face-runout" else str(feature["nominal"])
        response = client.post(f"/api/runs/{run['id']}/measurements", json={"featureId": feature["id"], "value": value, "shift": "71", "expectedSequence": index})
        assert response.status_code == 201, response.text
        assert response.json()["shift"] == "71"
        assert response.json()["status"] == "pass"
        assert response.json()["employeeNumber"] == "1234"
    completed = client.post(f"/api/runs/{run['id']}/complete", json={"shift": "71", "expectedSequence": len(part["features"])})
    assert completed.status_code == 200, completed.text
    assert completed.json()["completedShift"] == "71"
    assert completed.json()["completedByEmployeeNumber"] == "1234"
    summary = client.get("/api/runs", params={"summary": True, "jobNumber": "WEEKEND-71-001"}).json()[0]
    assert summary["lastRecordedShift"] == summary["completedShift"] == "71"
    assert "measurements" not in summary
    with database() as session:
        assert session.scalar(text("SELECT completed_shift FROM inspection_runs WHERE id=:id"), {"id": run["id"]}) == "71"
    with pytest.raises(DBAPIError), database.begin() as session:
        session.execute(text("UPDATE inspection_runs SET completed_shift='3' WHERE id=:id"), {"id": run["id"]})


@pytest.mark.parametrize("shift", ["0", "03", "3", "7", "071", "710", "71 ", " 71", "７１", "weekend", 71])
def test_new_shift_inputs_do_not_alias_weekend_or_retired_shift(client, shift):
    run = start(client)
    body = {"featureId": "f-dg1042-01", "value": "12.5", "shift": shift}
    assert client.post(f"/api/runs/{run['id']}/measurements", json=body).status_code == 422
    assert client.post(f"/api/runs/{run['id']}/complete", json={"shift": shift}).status_code == 422
    assert client.get(f"/api/runs/{run['id']}").json()["measurements"] == []


def test_weekend_migration_keeps_legacy_three_and_every_unrelated_guard(tmp_path, monkeypatch):
    url = "sqlite:///" + (tmp_path / "legacy-weekend.db").as_posix()
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0009_native_sketch_scope")
    engine = make_engine(url)
    with Session(engine) as session, session.begin():
        seed(session)
        session.execute(text("INSERT INTO employees(number,display_name,role,created_at) VALUES('1234','Historical operator','operator',CURRENT_TIMESTAMP)"))
        session.execute(text("INSERT INTO jobs(id,number,created_at) VALUES('old-shift-job','LEGACY-SHIFT-3',CURRENT_TIMESTAMP)"))
        for run_id, sample in [("old-completed", "01"), ("old-draft", "02")]:
            session.execute(text("""INSERT INTO inspection_runs(id,revision_id,operation_id,job_id,references_snapshot,inspector,employee_number,lot_number,sample_number,status,created_at)
              VALUES(:id,'rev-dg1042-c','op-dg1042-030','old-shift-job','{}','Historical inspector','1234','LOT-KEPT',:sample,'draft',CURRENT_TIMESTAMP)"""), {"id": run_id, "sample": sample})
            session.execute(text("""INSERT INTO measurements(id,sequence,run_id,feature_id,value,status,notes,recorded_at,employee_number,shift)
              SELECT :prefix || id,number,:run,id,nominal,'pass','Shift 3 as originally recorded',CURRENT_TIMESTAMP,'1234','3'
              FROM characteristics WHERE operation_id='op-dg1042-030'"""), {"prefix": run_id, "run": run_id})
        session.execute(text("UPDATE inspection_runs SET status='completed',completed_at=CURRENT_TIMESTAMP,completed_shift='3',completed_by_employee_number='1234' WHERE id='old-completed'"))
    with engine.connect() as connection:
        tables = [table for table in inspect(engine).get_table_names() if table != "alembic_version"]
        before = {table: connection.execute(text(f'SELECT * FROM "{table}" ORDER BY 1')).mappings().all() for table in tables}
        triggers = dict(connection.execute(text("SELECT name,sql FROM sqlite_master WHERE type='trigger'")).all())
    command.upgrade(config, "head")
    with engine.connect() as connection:
        after = {table: connection.execute(text(f'SELECT * FROM "{table}" ORDER BY 1')).mappings().all() for table in tables}
        assert before == after
        new_triggers = dict(connection.execute(text("SELECT name,sql FROM sqlite_master WHERE type='trigger'")).all())
        assert triggers.keys() == new_triggers.keys()
        for name in triggers.keys() - {"measurement_attribution_guard", "completion_attribution_guard"}:
            assert triggers[name] == new_triggers[name], name
        assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
        assert connection.scalar(text("SELECT completed_shift FROM inspection_runs WHERE id='old-completed'")) == "3"
        assert connection.scalar(text("SELECT count(*) FROM measurements WHERE shift='3'")) == 16
    assert next(column for column in inspect(engine).get_columns("measurements") if column["name"] == "shift")["type"].length == 2
    assert next(column for column in inspect(engine).get_columns("inspection_runs") if column["name"] == "completed_shift")["type"].length == 2

    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    def local_database():
        with sessions() as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise
    app.dependency_overrides[get_db] = local_database
    try:
        with TestClient(app) as client:
            assert client.post("/api/auth/login", json={"employeeNumber": "1234"}).status_code == 200
            historical = client.get("/api/runs/old-completed")
            assert historical.status_code == 200, historical.text
            assert historical.json()["completedShift"] == "3"
            assert all(event["shift"] == "3" for event in historical.json()["measurements"])
            assert client.post("/api/runs/old-completed/complete", json={"shift": "71"}).json() == historical.json()
            assert client.post("/api/runs/old-draft/measurements", json={"featureId": "f-dg1042-01", "value": "12.5", "shift": "3"}).status_code == 422
            weekend = client.post("/api/runs/old-draft/measurements", json={"featureId": "f-dg1042-01", "value": "12.5", "shift": "71", "expectedSequence": 8})
            assert weekend.status_code == 201, weekend.text
            completed = client.post("/api/runs/old-draft/complete", json={"shift": "71", "expectedSequence": 9})
            assert completed.status_code == 200, completed.text
            assert completed.json()["completedShift"] == "71"
            assert [event["shift"] for event in completed.json()["measurements"]] == ["3"] * 8 + ["71"]
            summaries = client.get("/api/runs?summary=true&jobNumber=LEGACY-SHIFT-3").json()
            assert {summary["completedShift"] for summary in summaries} == {"3", "71"}
    finally:
        app.dependency_overrides.clear()
    for statement in ["UPDATE measurements SET shift='71' WHERE run_id='old-completed'", "UPDATE inspection_runs SET completed_shift='71' WHERE id='old-completed'"]:
        with pytest.raises(DBAPIError), engine.begin() as connection:
            connection.execute(text(statement))
    engine.dispose()
