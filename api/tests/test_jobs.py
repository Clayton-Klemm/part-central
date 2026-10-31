import json
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import make_engine
from app.seed import DATA_PATH, seed
from test_inspection import start, measure
from test_catalog import catalog_admin


def test_jobs_are_required_normalized_and_reused_without_conflating_lots(client):
    first = start(client, jobNumber=" job-001 ", lotNumber="LOT-A")
    second = start(client, jobNumber="JOB-001", lotNumber="LOT-B")
    assert first["jobNumber"] == second["jobNumber"] == "JOB-001"
    assert first["jobId"] == second["jobId"]
    assert first["lotNumber"] != second["lotNumber"]
    third = start(client, jobNumber="JOB-002", lotNumber="")
    assert third["lotNumber"] == ""
    assert third["jobId"] != first["jobId"]
    for value in ["", "   ", "x" * 81]:
        response = client.post("/api/runs", json={"partRevisionId": first["partRevisionId"], "operationId": first["operationId"], "jobNumber": value, "inspector": "Taylor", "sampleNumber": "A1"})
        assert response.status_code == 422
    missing = client.post("/api/runs", json={"partRevisionId": first["partRevisionId"], "operationId": first["operationId"], "inspector": "Taylor", "sampleNumber": "A1"})
    assert missing.status_code == 422
    assert [job["number"] for job in client.get("/api/jobs?q=job-001").json()] == ["JOB-001"]


def test_history_job_search_pagination_and_summaries_do_not_expand_audit_events(client):
    first = start(client, jobNumber="ORDER-100")
    second = start(client, jobNumber="ORDER-100")
    third = start(client, jobNumber="ORDER-200")
    for value in ["13", "12.5", "12.51"]:
        assert measure(client, first, value).status_code == 201
    page = client.get("/api/runs", params={"summary": True, "jobNumber": "order-100", "limit": 1, "offset": 1}).json()
    assert [run["id"] for run in page] == [first["id"]]
    assert "measurements" not in page[0] and "references" not in page[0]
    assert page[0]["measurementCount"] == 1
    assert page[0]["partNumber"] == "DG-1042" and page[0]["revisionCode"] == "C"
    assert len(client.get(f"/api/runs/{first['id']}").json()["measurements"]) == 3
    assert [run["id"] for run in client.get("/api/runs?summary=true&search=ORDER-1").json()] == [second["id"], first["id"]]
    assert [run["id"] for run in client.get("/api/runs?summary=true&jobNumber=ORDER-200").json()] == [third["id"]]
    assert client.get("/api/runs?offset=-1").status_code == 422
    assert client.get("/api/runs?search=%").json() == []


def test_inspection_without_sketch_diagram_or_animation_is_complete_and_usable(catalog_admin):
    # Keep gradual-adoption coverage independent of the fully illustrated demo
    # library, whose seeded examples intentionally gain richer documentation.
    from test_catalog import create, feature, release, save
    client = catalog_admin
    requirement = feature()
    requirement["animationKey"] = None
    draft = save(client, create(client, "NO-VISUALS"), [requirement], geometryFamily=None).json()
    part = release(client, draft).json()
    assert len(part["features"]) == 1
    assert part["operation"]["sketchId"] is None
    assert all(feature["animationKey"] is None for feature in part["features"])
    assert part["references"]["sketch"] is None and part["references"]["diagram"] is None
    assert part["references"]["modelAvailable"] is False
    run = start(client, jobNumber="ADOPTION-001", partRevisionId=part["revision"]["id"], operationId=part["operation"]["id"])
    for feature in part["features"]:
        assert measure(client, run, str(feature["nominal"]), feature["id"]).status_code == 201
    completed = client.post(f"/api/runs/{run['id']}/complete", json={"shift": "1"}).json()
    assert completed["status"] == "completed" and completed["overallStatus"] == "pass"


def test_catalog_is_bounded_searchable_and_has_constant_query_count(client, database):
    calls = []
    engine = database.kw["bind"]
    def before_query(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith("SELECT"):
            calls.append(statement)
    event.listen(engine, "before_cursor_execute", before_query)
    try:
        parts = client.get("/api/parts?limit=50").json()
    finally:
        event.remove(engine, "before_cursor_execute", before_query)
    assert len(parts) >= 4 and len(calls) <= 2
    assert [part["number"] for part in client.get("/api/parts?q=RD-4").json()] == ["RD-4200"]
    assert client.get("/api/parts?q=%").json() == []
    assert len(client.get("/api/parts?limit=1&offset=1").json()) == 1
    assert client.get("/api/parts?limit=51").status_code == 422


def test_exact_revision_lookup_rejects_cross_part_revision(client):
    response = client.get("/api/parts/DG-1042?revisionId=rev-dg1042-c")
    assert response.status_code == 200 and response.json()["revision"]["code"] == "C"
    assert client.get("/api/parts/DG-1042?revisionId=rev-dg2080-b").status_code == 404


def test_job_and_pinned_reference_identity_cannot_be_changed(client, database):
    first = start(client, jobNumber="IMMUTABLE-001")
    second = start(client, jobNumber="IMMUTABLE-002")
    for sql, parameters in [
        ("UPDATE inspection_runs SET job_id=:new WHERE id=:id", {"id": first["id"], "new": second["jobId"]}),
        ("UPDATE inspection_runs SET references_snapshot='{}' WHERE id=:id", {"id": first["id"]}),
        ("UPDATE jobs SET number='REWRITTEN' WHERE id=:id", {"id": first["jobId"]}),
    ]:
        with pytest.raises(IntegrityError), database.begin() as session:
            session.execute(text(sql), parameters)


def test_job_migration_preserves_completed_legacy_runs_history_and_reference_baseline(tmp_path, monkeypatch):
    url = "sqlite:///" + (tmp_path / "legacy-jobs.db").as_posix()
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "20261026_sample_id")
    engine = make_engine(url)
    legacy = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    legacy["parts"] = [part for part in legacy["parts"] if part["operation"].get("sketchId")]
    legacy["revisionExamples"] = []
    fixture = tmp_path / "legacy-catalog.json"
    fixture.write_text(json.dumps(legacy), encoding="utf-8")
    with Session(engine) as session, session.begin():
        seed(session, fixture)
        session.execute(text("INSERT INTO inspection_runs(id,revision_id,operation_id,inspector,lot_number,sample_number,status,created_at) VALUES('old-run','rev-dg1042-c','op-dg1042-030','Taylor','OLD-LOT','01','draft',CURRENT_TIMESTAMP)"))
        session.execute(text("INSERT INTO measurements(id,sequence,run_id,feature_id,value,status,notes,recorded_at) SELECT id, number, 'old-run', id, nominal, 'pass', '', CURRENT_TIMESTAMP FROM characteristics WHERE operation_id='op-dg1042-030'"))
        session.execute(text("UPDATE inspection_runs SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE id='old-run'"))
    command.upgrade(config, "head")
    with engine.connect() as connection:
        row = connection.execute(text("SELECT r.status, r.references_snapshot, j.number FROM inspection_runs r JOIN jobs j ON j.id=r.job_id WHERE r.id='old-run'")).one()
        assert row[0] == "completed" and row[2] == "LEGACY-OLD-LOT"
        snapshot = json.loads(row[1])
        assert snapshot["version"] == 0 and snapshot["sketch"]["id"] == "SK-DG1042-030-C"
        assert snapshot["modelAvailable"] is True
        assert connection.scalar(text("SELECT count(*) FROM measurements WHERE run_id='old-run'")) == 8
    for sql in ["UPDATE inspection_runs SET inspector='Changed' WHERE id='old-run'", "DELETE FROM measurements WHERE run_id='old-run'", "UPDATE characteristics SET nominal=99 WHERE id='f-dg1042-01'"]:
        with pytest.raises(IntegrityError), engine.begin() as connection:
            connection.execute(text(sql))
    engine.dispose()
