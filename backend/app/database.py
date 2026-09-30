"""Database engine, session factory and declarative Base.

* ``Base``          - SQLAlchemy 2.x DeclarativeBase for every model in app.models.
* ``make_engine``   - builds an engine; SQLite gets ``check_same_thread=False``,
                      in-memory SQLite (``sqlite://``) gets a StaticPool, and every
                      SQLite connection runs ``PRAGMA foreign_keys=ON`` (so the
                      ON DELETE CASCADE rules in models.py work).
* ``engine`` / ``SessionLocal`` - module-level, built from settings.DATABASE_URL.
* ``get_db``        - FastAPI dependency yielding a Session (overridden in tests).
* ``utcnow``        - naive UTC "now" used for every timestamp column.

Relative SQLite paths (``sqlite:///./fraud.db``) are resolved against the
``backend/`` folder, so the database is the same file whatever the current
working directory is.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import BACKEND_DIR, get_settings


def utcnow() -> datetime:
    """Current server-local time as a naive datetime.

    System timestamps (created_at, evaluated_at, ...) use the same naive local
    clock as the simulator and the browser, so relative times ("12 min ago")
    are correct in the console. See DECISIONS.md.
    """
    return datetime.now().replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


def _is_memory_sqlite(url: str) -> bool:
    return url in ("sqlite://", "sqlite:///", "sqlite:///:memory:") or "mode=memory" in url


def resolve_sqlite_url(url: str) -> str:
    """Make a relative ``sqlite:///./x.db`` path absolute under backend/."""
    prefix = "sqlite:///"
    if not url.startswith(prefix) or _is_memory_sqlite(url):
        return url
    path = url[len(prefix):]
    if not path or path.startswith("/") or (len(path) > 1 and path[1] == ":"):
        return url  # already absolute (POSIX "////abs" or Windows "C:/...")
    return prefix + (BACKEND_DIR / path).resolve().as_posix()


def _enable_sqlite_fk(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def make_engine(url: str, **kwargs) -> Engine:
    """Create an engine for `url` with the SQLite tweaks described above."""
    if url.startswith("sqlite"):
        url = resolve_sqlite_url(url)
        connect_args = dict(kwargs.pop("connect_args", {}) or {})
        connect_args.setdefault("check_same_thread", False)
        kwargs["connect_args"] = connect_args
        if _is_memory_sqlite(url):
            kwargs.setdefault("poolclass", StaticPool)
    eng = create_engine(url, **kwargs)
    if eng.dialect.name == "sqlite":
        event.listen(eng, "connect", _enable_sqlite_fk)
    return eng


def make_session_factory(bind: Engine) -> sessionmaker[Session]:
    """Session factory used by the app, the CLI and the tests (same options everywhere)."""
    return sessionmaker(bind=bind, autoflush=True, expire_on_commit=True)


engine: Engine = make_engine(get_settings().DATABASE_URL)
SessionLocal = make_session_factory(engine)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one Session per request, always closed afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
