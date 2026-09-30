"""Domain events (plan Section 9.2).

Every event is a frozen, keyword-only dataclass inheriting ``Event``:

    bus.publish(FraudFlagged(flag_id=3, transaction_id="T020", score=100,
                             level=RiskLevel.CRITICAL, fired_rules=[...]), db)

* ``event.name``        -> class name, e.g. "FraudFlagged" (also the audit ``action``)
* ``event.occurred_at`` -> naive UTC datetime, set automatically
* ``event.payload()``   -> JSON-safe dict of the fields (without occurred_at);
                           datetimes become ISO strings, enums their values.

``fired_rules`` lists contain rule *names* (snake_case, e.g. "impossible_travel").
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from app.database import utcnow

__all__ = [
    "Event",
    "TransactionReceived",
    "TransactionEvaluated",
    "FraudFlagged",
    "HighRiskDetected",
    "NotificationProcessed",
    "FlagStatusChanged",
    "RuleConfigUpdated",
    "UserLoggedIn",
    "DemoLoaded",
    "CsvUploaded",
    "DataReset",
    "SimulationRun",
    "TestAlertSent",
    "ALL_EVENTS",
    "to_jsonable",
]


def to_jsonable(value: Any) -> Any:
    """Recursively convert a value into JSON-safe primitives."""
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {str(to_jsonable(k)): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [to_jsonable(v) for v in value]
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {f.name: to_jsonable(getattr(value, f.name)) for f in dataclasses.fields(value)}
    if hasattr(value, "model_dump"):  # pydantic models
        return to_jsonable(value.model_dump(mode="json"))
    return value


@dataclass(frozen=True, kw_only=True)
class Event:
    """Base class of every event. Subclasses add their payload fields."""

    occurred_at: datetime = field(default_factory=utcnow)

    @property
    def name(self) -> str:
        return type(self).__name__

    def payload(self) -> dict[str, Any]:
        return {
            f.name: to_jsonable(getattr(self, f.name))
            for f in dataclasses.fields(self)
            if f.name != "occurred_at"
        }


# ---------------------------------------------------------------- pipeline


@dataclass(frozen=True, kw_only=True)
class TransactionReceived(Event):
    transaction_id: str
    customer_id: str
    amount: float
    source: str  # "api" | "csv" | "demo" | "simulator"


@dataclass(frozen=True, kw_only=True)
class TransactionEvaluated(Event):
    transaction_id: str
    score: int
    raw_score: int
    level: str
    fired_rules: list[str] = field(default_factory=list)


@dataclass(frozen=True, kw_only=True)
class FraudFlagged(Event):
    flag_id: int
    transaction_id: str
    score: int
    level: str
    fired_rules: list[str] = field(default_factory=list)


@dataclass(frozen=True, kw_only=True)
class HighRiskDetected(Event):
    flag_id: int
    transaction_id: str
    score: int
    level: str


@dataclass(frozen=True, kw_only=True)
class NotificationProcessed(Event):
    flag_id: int | None
    channel: str
    status: str
    error: str | None = None


# ---------------------------------------------------------------- review / config


@dataclass(frozen=True, kw_only=True)
class FlagStatusChanged(Event):
    flag_id: int
    transaction_id: str
    from_status: str
    to_status: str
    note: str | None = None
    user_id: int | None = None


@dataclass(frozen=True, kw_only=True)
class RuleConfigUpdated(Event):
    rule_name: str
    before: dict[str, Any] = field(default_factory=dict)  # {enabled, score, params}
    after: dict[str, Any] = field(default_factory=dict)
    user_id: int | None = None


@dataclass(frozen=True, kw_only=True)
class UserLoggedIn(Event):
    user_id: int
    username: str


# ---------------------------------------------------------------- admin / batch


@dataclass(frozen=True, kw_only=True)
class DemoLoaded(Event):
    summary: dict[str, Any] = field(default_factory=dict)  # BatchSummary as dict
    user_id: int | None = None


@dataclass(frozen=True, kw_only=True)
class CsvUploaded(Event):
    summary: dict[str, Any] = field(default_factory=dict)  # BatchSummary as dict
    user_id: int | None = None
    filename: str | None = None


@dataclass(frozen=True, kw_only=True)
class DataReset(Event):
    user_id: int | None = None
    deleted: dict[str, int] = field(default_factory=dict)  # table -> rows deleted


@dataclass(frozen=True, kw_only=True)
class SimulationRun(Event):
    scenario: str
    customer_ids: list[str] = field(default_factory=list)
    user_id: int | None = None
    summary: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, kw_only=True)
class TestAlertSent(Event):
    __test__ = False  # not a pytest test class

    channel: str
    status: str
    user_id: int | None = None


ALL_EVENTS: tuple[type[Event], ...] = (
    TransactionReceived,
    TransactionEvaluated,
    FraudFlagged,
    HighRiskDetected,
    NotificationProcessed,
    FlagStatusChanged,
    RuleConfigUpdated,
    UserLoggedIn,
    DemoLoaded,
    CsvUploaded,
    DataReset,
    SimulationRun,
    TestAlertSent,
)
