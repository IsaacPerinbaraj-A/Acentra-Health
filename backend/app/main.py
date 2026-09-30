"""FastAPI application: RiskLens Fraud Engine.

Run: ``cd backend && uvicorn app.main:app --reload``

The lifespan creates the tables, seeds demo users, discovers rules from
``app/rules/``, syncs ``rule_configs``, builds the RuleEngine and the EventBus
(wired with ``register_handlers``) and stores them on ``app.state``
(``engine``, ``bus``, ``rules``). Tests build the client without the lifespan
and set ``app.state`` / dependency overrides themselves (tests/conftest.py).
"""

from __future__ import annotations

import importlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401 - registers every table on Base.metadata
import app.rules as rules_package
from app.api import ROUTER_MODULES
from app.config import Settings, get_settings
from app.database import Base, SessionLocal
from app.database import engine as db_engine
from app.engine.engine import RuleEngine
from app.engine.registry import discover_rules
from app.events.bus import EventBus
from app.events.handlers import register_handlers
from app.seed import seed_users, sync_rule_configs

logger = logging.getLogger("app")

__all__ = ["app", "create_app", "init_app_state", "configure_logging"]


def configure_logging(level: int = logging.INFO) -> None:
    """INFO logging for the ``app.*`` loggers, so notifier log-mode alerts show in uvicorn output."""
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(
            level=level,
            format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        )
    app_logger = logging.getLogger("app")
    app_logger.setLevel(level)
    if not app_logger.handlers and not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
        app_logger.addHandler(handler)


def init_app_state(
    fastapi_app: FastAPI,
    *,
    bind: Engine | None = None,
    session_factory: sessionmaker[Session] | None = None,
    settings: Settings | None = None,
    bcrypt_rounds: int = 12,
) -> None:
    """Create tables, seed users, discover rules, sync configs, build engine + bus on app.state."""
    settings = settings or get_settings()
    bind = bind or db_engine
    session_factory = session_factory or SessionLocal

    Base.metadata.create_all(bind)
    rules = discover_rules(rules_package)
    with session_factory() as db:
        seed_users(db, settings, rounds=bcrypt_rounds)
        sync_rule_configs(db, rules)

    bus = EventBus(feed_size=settings.EVENT_FEED_SIZE)
    register_handlers(bus)

    fastapi_app.state.rules = rules
    fastapi_app.state.engine = RuleEngine(rules)
    fastapi_app.state.bus = bus
    logger.info(
        "RiskLens ready: %d rules (%s), notify_mode=%s",
        len(rules),
        ", ".join(sorted(rules)),
        settings.notify_mode_normalized,
    )


@asynccontextmanager
async def lifespan(fastapi_app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    init_app_state(fastapi_app)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="RiskLens Fraud Engine",
        version="1.0.0",
        description="Explainable fraud rule engine with a reviewer console.",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for module_name in ROUTER_MODULES:
        module = importlib.import_module(f"app.api.{module_name}")
        application.include_router(module.router)

    @application.get("/api/health", tags=["Health"])
    def health(request: Request, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
        state = request.app.state
        rules = getattr(state, "rules", None) or {}
        bus = getattr(state, "bus", None)
        return {
            "status": "ok",
            "notify_mode": settings.notify_mode_normalized,
            "rules_loaded": sorted(rules),
            "event_handlers": bus.handler_counts() if bus is not None else {},
        }

    return application


configure_logging()
app = create_app()
