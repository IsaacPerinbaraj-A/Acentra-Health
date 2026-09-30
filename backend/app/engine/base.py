"""Rule contract (plan Section 7.1) and shared formatting helpers.

A rule is a class in ``app/rules/<file>.py`` that subclasses ``FraudRule``::

    class NewDeviceRule(FraudRule):
        name = "new_device"
        display_name = "New device"
        description = "Fires when a customer with history uses a device never seen before."
        default_score = 20
        default_params = {"min_history": 3}

        def evaluate(self, txn, ctx, params):
            ...
            return RuleResult(self.name, True, "reason", {"evidence": 1})

Rules decide *whether* they fire and *why*; the engine assigns the score.
``txn`` is the ORM Transaction or any object with the same attributes
(transaction_id, customer_id, amount, currency, merchant, city, latitude,
longitude, timestamp, device_id, account_balance).
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, ClassVar

if TYPE_CHECKING:  # pragma: no cover
    from sqlalchemy.orm import Session

__all__ = [
    "RuleResult",
    "RuleContext",
    "FraudRule",
    "format_inr",
    "format_duration",
    "format_number",
    "plural",
    "fmt_param",
]


@dataclass
class RuleResult:
    rule_name: str
    triggered: bool
    reason: str  # always filled, also when passed
    details: dict = field(default_factory=dict)
    score: int = 0  # set by the engine, not by the rule


@dataclass
class RuleContext:
    # same customer, timestamp < current, ascending, max HISTORY_LIMIT (most recent)
    history: list[Any] = field(default_factory=list)
    # for rules that look beyond one customer (shared_device); None in pure tests
    session: Session | None = None


class FraudRule(ABC):
    name: ClassVar[str]  # unique snake_case id, e.g. "velocity"
    display_name: ClassVar[str]  # e.g. "Transaction velocity"
    description: ClassVar[str]  # one sentence for the Rules page
    default_score: ClassVar[int]
    default_params: ClassVar[dict]

    @abstractmethod
    def evaluate(self, txn: Any, ctx: RuleContext, params: dict) -> RuleResult: ...


# ---------------------------------------------------------------- formatting


def _group_indian(n: int) -> str:
    s = str(n)
    if len(s) <= 3:
        return s
    head, last3 = s[:-3], s[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join(groups) + "," + last3


def format_inr(amount: float | int) -> str:
    """Indian-grouped rupees: 125000 -> "₹1,25,000", 25000 -> "₹25,000", 1234.5 -> "₹1,234.50".

    No decimals when the amount is whole (after rounding to paise).
    """
    value = float(amount)
    negative = value < 0
    paise = int(round(abs(value) * 100))
    whole, frac = divmod(paise, 100)
    text = "₹" + _group_indian(whole) + (f".{frac:02d}" if frac else "")
    return "-" + text if negative else text


def format_duration(minutes: float) -> str:
    """30 -> "30 min", 240 -> "4 h 0 min", 90.4 -> "1 h 30 min" (minutes rounded)."""
    total = int(math.floor(max(0.0, float(minutes)) + 0.5))
    if total < 60:
        return f"{total} min"
    hours, mins = divmod(total, 60)
    return f"{hours} h {mins} min"


def format_number(value: float | int, decimals: int = 0) -> str:
    """Western thousands grouping: 1756.4 -> "1,756", 3512 -> "3,512"."""
    return f"{float(value):,.{decimals}f}"


def plural(count: int, singular: str, plural_form: str | None = None) -> str:
    """plural(1, "transaction") -> "1 transaction"; plural(0, ...) -> "0 transactions"."""
    word = singular if count == 1 else (plural_form or singular + "s")
    return f"{count} {word}"


def fmt_param(value: Any) -> str:
    """Render a numeric param without a pointless ".0" (900.0 -> "900", 2.5 -> "2.5")."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)
