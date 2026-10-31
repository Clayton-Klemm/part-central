import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    options = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {
        "pool_size": int(os.getenv("DB_POOL_SIZE", "5")),
        "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "5")),
        "pool_timeout": int(os.getenv("DB_POOL_TIMEOUT", "10")),
        "pool_recycle": 1800,
    }
    engine = create_engine(url, pool_pre_ping=True, **options)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
    return engine


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./partcentral.db")
engine = make_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    with SessionLocal() as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
