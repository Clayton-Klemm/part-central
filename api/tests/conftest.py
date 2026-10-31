import sys
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.database import get_db, make_engine
from app.main import app
from app.seed import seed


@pytest.fixture
def database(tmp_path, monkeypatch):
    url = "sqlite:///" + (tmp_path / "inspection.db").as_posix()
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config(str(API_ROOT / "alembic.ini"))
    command.upgrade(config, "head")
    engine = make_engine(url)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    with sessions.begin() as session:
        seed(session)
    yield sessions
    engine.dispose()


@pytest.fixture
def client(database):
    def test_db():
        with database() as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise
    app.dependency_overrides[get_db] = test_db
    with TestClient(app) as client:
        signed_in = client.post("/api/auth/login", json={"employeeNumber": "1234"})
        assert signed_in.status_code == 200, signed_in.text
        yield client
    app.dependency_overrides.clear()
