"""Native drawings are scoped by relational identity across every part family."""
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.database import make_engine
from app.models import Operation, PartRevision, Sketch
from app.seed import seed
from test_references import admin, upload


@pytest.mark.parametrize("number", ["RD-4200", "DF-5200", "BC-5300", "AF-5400", "SS-5500", "MF-6100", "PH-7200"])
def test_native_sketch_editions_publish_for_every_non_gear_family_and_pin_history(client, admin, database, number):
    part = client.get(f"/api/parts/{number}").json()
    baseline = part["references"]
    assert baseline["sketch"] and baseline["modelAvailable"]
    assert not part["operation"]["id"].startswith("op-dg")
    body = {"partRevisionId": part["revision"]["id"], "operationId": part["operation"]["id"], "jobNumber": "NATIVE-SKETCH-" + number, "sampleNumber": "BEFORE", "inspector": "Ignored client author"}
    before = client.post("/api/runs", json=body).json()
    path = f"/api/admin/operations/{part['operation']['id']}/references"
    published = client.post(path, json={"expectedVersion": 0, "sketchAssetId": baseline["sketch"]["id"], "modelAvailable": True, "notes": "All-family native drawing verification"}, headers=admin)
    assert published.status_code == 201, published.text
    edition = published.json()
    assert edition["version"] == 1 and edition["sketch"] == baseline["sketch"]
    assert edition["modelAvailable"] is True
    assert client.get(f"/api/runs/{before['id']}").json()["references"] == baseline
    after = client.post("/api/runs", json={**body, "sampleNumber": "AFTER"}).json()
    assert after["references"] == edition
    for sql in ["UPDATE operation_reference_versions SET notes='Changed' WHERE id=:id", "DELETE FROM operation_reference_versions WHERE id=:id"]:
        with pytest.raises(DBAPIError, match="append-only"), database.begin() as session:
            session.execute(text(sql), {"id": edition["id"]})
    wrong = client.get("/api/parts/DG-1042").json()["references"]["sketch"]["id"]
    assert client.post(path, json={"expectedVersion": 1, "sketchAssetId": wrong}, headers=admin).status_code == 422
    with pytest.raises(DBAPIError, match="Built-in sketch"), database.begin() as session:
        session.execute(text("""INSERT INTO operation_reference_versions
          (id,operation_id,version,builtin_sketch_id,model_available,notes,created_at)
          VALUES('wrong-native-owner',:operation,2,:sketch,0,'Wrong owner',CURRENT_TIMESTAMP)"""),
          {"operation": part["operation"]["id"], "sketch": wrong})


def test_native_and_uploaded_sketch_pointers_cannot_be_combined(client, admin, database):
    part = client.get("/api/parts/DF-5200").json()
    asset = upload(client, admin, operation=part["operation"]["id"]).json()
    with pytest.raises(DBAPIError, match="Built-in sketch"), database.begin() as session:
        session.execute(text("""INSERT INTO operation_reference_versions
          (id,operation_id,version,builtin_sketch_id,sketch_asset_id,model_available,notes,created_at)
          VALUES('ambiguous-native',:operation,1,:native,:upload,0,'Ambiguous sketch',CURRENT_TIMESTAMP)"""),
          {"operation": part["operation"]["id"], "native": part["references"]["sketch"]["id"], "upload": asset["id"]})


@pytest.mark.parametrize("selected,referenced,path", [
    ("selected", "unselected", "generated://operation-sketch"),
    ("selected", "selected", "https://unapproved.invalid/drawing"),
])
def test_native_pointer_requires_current_operation_sketch_and_generated_asset(client, database, selected, referenced, path):
    with database.begin() as session:
        session.add(PartRevision(id="rev-native-scope", part_id="p-dg1042", code="NATIVE-SCOPE", status="draft", material="Synthetic", finish="Machined", geometry_family="shaft"))
        session.flush()
        for identifier in ("selected", "unselected"):
            session.add(Sketch(id=identifier, revision_id="rev-native-scope", title="Native scope test", asset_path=path))
        session.flush()
        session.add(Operation(id="opaque-operation-id", revision_id="rev-native-scope", code="010", name="Scope check", setup="Synthetic", sketch_id=selected))
    with pytest.raises(DBAPIError, match="Built-in sketch"), database.begin() as session:
        session.execute(text("""INSERT INTO operation_reference_versions
          (id,operation_id,version,builtin_sketch_id,model_available,notes,created_at)
          VALUES('invalid-native-path','opaque-operation-id',1,:sketch,0,'Invalid pointer',CURRENT_TIMESTAMP)"""), {"sketch": referenced})


def test_native_guard_migration_preserves_existing_editions_and_relaxes_only_prefix_rule(tmp_path, monkeypatch):
    url = "sqlite:///" + (tmp_path / "legacy-native.db").as_posix()
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0008_shift_attribution")
    engine = make_engine(url)
    with Session(engine) as session, session.begin():
        seed(session)
        session.execute(text("""INSERT INTO operation_reference_versions
          (id,operation_id,version,builtin_sketch_id,model_available,notes,created_at)
          VALUES('historical-gear','op-dg1042-030',1,'SK-DG1042-030-C',1,'Original edition',CURRENT_TIMESTAMP)"""))
    statement = """INSERT INTO operation_reference_versions
      (id,operation_id,version,builtin_sketch_id,model_available,notes,created_at)
      VALUES('native-differential','op-df5200-a-030',1,'SK-DF5200-030-A',1,'Native differential edition',CURRENT_TIMESTAMP)"""
    with pytest.raises(DBAPIError, match="Built-in sketch"), engine.begin() as connection:
        connection.execute(text(statement))
    with engine.connect() as connection:
        before = connection.execute(text("SELECT * FROM operation_reference_versions ORDER BY id")).all()
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT * FROM operation_reference_versions ORDER BY id")).all() == before
        assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
    with engine.begin() as connection:
        connection.execute(text(statement))
    with pytest.raises(DBAPIError, match="append-only"), engine.begin() as connection:
        connection.execute(text("UPDATE operation_reference_versions SET notes='Changed' WHERE id='historical-gear'"))
    engine.dispose()
