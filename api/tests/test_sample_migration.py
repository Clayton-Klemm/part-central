import json
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import make_engine
from app.seed import DATA_PATH, seed


def test_sample_label_migration_keeps_existing_runs_history_and_guards(tmp_path, monkeypatch):
    url = "sqlite:///" + (tmp_path / "legacy.db").as_posix()
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "20261026_integrity")
    engine = make_engine(url)
    legacy_data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    legacy_data["parts"] = [part for part in legacy_data["parts"] if part["operation"].get("sketchId")]
    legacy_data["revisionExamples"] = []
    fixture = tmp_path / "legacy-catalog.json"
    fixture.write_text(json.dumps(legacy_data), encoding="utf-8")
    with Session(engine) as session, session.begin():
        seed(session, fixture)
        session.execute(text("""
            INSERT INTO inspection_runs (id, revision_id, operation_id, inspector, lot_number,
              sample_number, status, created_at)
            VALUES ('legacy-run', 'rev-dg1042-c', 'op-dg1042-030', 'Taylor', 'LOT-01', 7, 'draft', CURRENT_TIMESTAMP)
        """))
        session.execute(text("""
            INSERT INTO measurements (id, sequence, run_id, feature_id, value, status, notes, recorded_at)
            VALUES ('legacy-event', 1, 'legacy-run', 'f-dg1042-01', 12.5, 'pass', '', CURRENT_TIMESTAMP)
        """))
    command.upgrade(config, "20261026_sample_id")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT sample_number FROM inspection_runs WHERE id='legacy-run'")) == "7"
        assert connection.scalar(text("SELECT value FROM measurements WHERE id='legacy-event'")) == 12.5
        assert connection.scalar(text("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name='measurements_validate'")) == 1
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("UPDATE inspection_runs SET inspector='Overwrite' WHERE id='legacy-run'"))
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("UPDATE measurements SET value=99 WHERE id='legacy-event'"))
    with engine.begin() as connection:
        connection.execute(text("""
            INSERT INTO inspection_runs (id, revision_id, operation_id, inspector, lot_number,
              sample_number, status, created_at)
            VALUES ('alpha-run', 'rev-dg1042-c', 'op-dg1042-030', 'Taylor', 'LOT-01', 'A1', 'draft', CURRENT_TIMESTAMP)
        """))
    with pytest.raises(RuntimeError, match="would lose information"):
        command.downgrade(config, "20261026_integrity")
    engine.dispose()

