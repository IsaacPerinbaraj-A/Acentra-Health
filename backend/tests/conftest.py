"""Shared pytest fixtures (plan Section 20).

Every test gets a fresh in-memory SQLite database (StaticPool), seeded users
(bcrypt rounds=4) and rule configs, a fresh EventBus wired with
``register_handlers``, and - via ``client`` - a TestClient whose dependencies
(get_db / get_bus / get_engine / get_rules / get_settings) point at them.
The client is built without the lifespan, and DATABASE_URL is pointed at a
temporary file before any ``app`` import, so tests never touch backend/fraud.db.
NOTIFY_MODE is forced to "log" (monkeypatch it again inside a test to change it).

Fixtures: settings, db_engine, session_factory, rules, engine, db, bus, client,
auth_headers(role) -> headers, api_key_headers, make_txn_payload(**overrides) -> dict,
demo_loaded -> BatchSummary.
"""

from __future__ import annotations

import itertools
import os
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

# ---- environment BEFORE any `app` import -------------------------------------------
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

_TMP_DIR = Path(tempfile.mkdtemp(prefix="risklens-tests-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (_TMP_DIR / "test.db").as_posix()
os.environ["NOTIFY_MODE"] = "log"
os.environ["SNS_TOPIC_ARN"] = ""
os.environ["SES_SENDER"] = ""
os.environ["SES_RECIPIENTS"] = ""
# Never reach real AWS from tests (moto-based tests mock on top of these).
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ["AWS_SECURITY_TOKEN"] = "testing"
os.environ["AWS_SESSION_TOKEN"] = "testing"
os.environ["AWS_DEFAULT_REGION"] = "ap-south-1"
os.environ.pop("AWS_PROFILE", None)

import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database import Base, make_engine, make_session_factory  # noqa: E402
from app.engine.engine import RuleEngine  # noqa: E402
from app.engine.registry import discover_rules  # noqa: E402
from app.enums import Role  # noqa: E402
from app.events.bus import EventBus  # noqa: E402
from app.events.handlers import register_handlers  # noqa: E402
import app.models as models  # noqa: E402,F401
from app.security import create_access_token  # noqa: E402
from app.seed import seed_users, sync_rule_configs  # noqa: E402


# ---- settings ------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    """The shared Settings object with NOTIFY_MODE forced to "log" (restored after the test)."""
    s = get_settings()
    monkeypatch.setattr(s, "NOTIFY_MODE", "log")
    return s


# ---- database ------------------------------------------------------------------------


@pytest.fixture
def db_engine():
    eng = make_engine("sqlite://")  # in-memory + StaticPool (see app.database.make_engine)
    Base.metadata.create_all(eng)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def session_factory(db_engine):
    return make_session_factory(db_engine)


@pytest.fixture(scope="session")
def rules():
    """{name: FraudRule class} discovered from app/rules/."""
    return discover_rules("app.rules")


@pytest.fixture
def engine(rules):
    """A RuleEngine over the discovered rules (not the SQLAlchemy engine - see db_engine)."""
    return RuleEngine(rules)


@pytest.fixture
def db(session_factory, rules, settings):
    session = session_factory()
    seed_users(session, settings, rounds=4)
    sync_rule_configs(session, rules)
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def bus(settings):
    b = EventBus(feed_size=settings.EVENT_FEED_SIZE)
    register_handlers(b)
    return b


# ---- API client ----------------------------------------------------------------------


@pytest.fixture
def client(db, bus, engine, rules, settings):
    """TestClient (no lifespan) sharing the test's `db` session, bus, engine and rules."""
    from fastapi.testclient import TestClient

    from app.api import deps
    from app.main import app as fastapi_app

    def override_get_db():
        try:
            yield db
        except Exception:
            db.rollback()
            raise

    overrides = {
        deps.get_db: override_get_db,
        deps.get_bus: lambda: bus,
        deps.get_engine: lambda: engine,
        deps.get_rules: lambda: rules,
        deps.get_settings: lambda: settings,
    }
    fastapi_app.dependency_overrides.update(overrides)
    previous_state = {k: getattr(fastapi_app.state, k, None) for k in ("bus", "engine", "rules")}
    fastapi_app.state.bus = bus
    fastapi_app.state.engine = engine
    fastapi_app.state.rules = rules
    try:
        yield TestClient(fastapi_app)
    finally:
        fastapi_app.dependency_overrides.clear()
        for key, value in previous_state.items():
            setattr(fastapi_app.state, key, value)


@pytest.fixture
def auth_headers(db, settings):
    """auth_headers("ADMIN" | "reviewer" | Role.VIEWER) -> {"Authorization": "Bearer ..."}"""
    from app.models import User

    def _headers(role="ADMIN") -> dict[str, str]:
        role_value = Role(str(role.value if isinstance(role, Role) else role).upper()).value
        user = db.scalars(select(User).where(User.role == role_value).order_by(User.id)).first()
        if user is None:
            raise LookupError(f"No seeded user with role {role_value}")
        return {"Authorization": f"Bearer {create_access_token(user, settings)}"}

    return _headers


@pytest.fixture
def api_key_headers(settings):
    return {"X-API-Key": settings.INGEST_API_KEY}


@pytest.fixture
def make_txn_payload():
    """make_txn_payload(**overrides) -> JSON-ready TransactionIn dict.

    Defaults: unique transaction_id, customer C900, INR 1000 at "Test Store" in Mumbai,
    balance 100000, a per-customer device (DEV-<customer_id>), and a timestamp that
    advances one hour per call (from 2026-10-01T09:00:00) so defaults never trip velocity.
    """
    counter = itertools.count(1)
    base = datetime(2026, 10, 1, 9, 0, 0)

    def _make(**overrides) -> dict:
        n = next(counter)
        payload = {
            "transaction_id": f"TX{n:05d}",
            "customer_id": "C900",
            "amount": 1000.0,
            "currency": "INR",
            "merchant": "Test Store",
            "city": "Mumbai",
            "latitude": 19.0760,
            "longitude": 72.8777,
            "timestamp": (base + timedelta(hours=n - 1)).isoformat(),
            "account_balance": 100000.0,
        }
        payload.update(overrides)
        if "device_id" not in overrides:
            payload["device_id"] = f"DEV-{payload['customer_id']}"
        if isinstance(payload.get("timestamp"), datetime):
            payload["timestamp"] = payload["timestamp"].isoformat()
        return payload

    return _make


@pytest.fixture
def demo_loaded(db, engine, bus):
    """Loads sample_data/demo_transactions.csv through services.ingest.load_demo; returns the summary."""
    from app.services.ingest import load_demo

    return load_demo(db, engine, bus)
