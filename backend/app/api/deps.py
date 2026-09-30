"""Shared FastAPI dependencies for routers.

``get_db`` and ``get_settings`` are the *same objects* as ``app.database.get_db`` and
``app.config.get_settings`` (which app.security also depends on), so one
``app.dependency_overrides[get_db]`` covers every route in tests.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request

from app.config import get_settings
from app.database import get_db
from app.engine.engine import RuleEngine
from app.events.bus import EventBus

__all__ = ["get_db", "get_settings", "get_bus", "get_engine", "get_rules"]


def get_bus(request: Request) -> EventBus:
    """The app's EventBus (``app.state.bus``, set in the lifespan)."""
    return request.app.state.bus


def get_engine(request: Request) -> RuleEngine:
    """The app's RuleEngine (``app.state.engine``)."""
    return request.app.state.engine


def get_rules(request: Request) -> dict[str, Any]:
    """Discovered rules ``{name: FraudRule class}`` (``app.state.rules``)."""
    return request.app.state.rules
