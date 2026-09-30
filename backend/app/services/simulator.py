"""Scenario simulator (plan Section 17).

``run_scenario(db, engine, bus, "velocity")`` creates fresh customers
``SIM-XXXX`` (random 4 digits, retried on clash) with transaction ids
``SIM-XXXX-01``, ``-02``, ... and naive timestamps relative to
``datetime.now()`` (all <= now, ascending). Balances are consistent: each is
the previous balance minus the previous payment. Every transaction goes
through ``services.ingest.ingest_transaction(source="simulator")``; afterwards
a ``SimulationRun`` event is published.

Amounts are chosen so that, under the default rule params, ONLY the rule(s)
the scenario is about fire.
"""

from __future__ import annotations

import random
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.enums import RiskLevel, max_level
from app.events.events import SimulationRun
from app.models import Transaction

__all__ = ["SCENARIOS", "list_scenarios", "run_scenario"]

SOURCE = "simulator"

# name -> (latitude, longitude)
CITIES: dict[str, tuple[float, float]] = {
    "Chennai": (13.0827, 80.2707),
    "Delhi": (28.6139, 77.2090),
    "Mumbai": (19.0760, 72.8777),
    "Bengaluru": (12.9716, 77.5946),
    "Hyderabad": (17.3850, 78.4867),
    "Kolkata": (22.5726, 88.3639),
    "Pune": (18.5204, 73.8567),
}

SCENARIOS: dict[str, dict[str, str]] = {
    "normal": {
        "key": "normal",
        "name": "Normal customer",
        "description": "4 small payments (₹200–₹2,000) in the same city, 2–3 hours apart, ending now.",
        "expected_level": "LOW",
    },
    "velocity": {
        "key": "velocity",
        "name": "Transaction velocity (card testing)",
        "description": "3 normal payments hours earlier, then 6 small payments 90 seconds apart ending now.",
        "expected_level": "MEDIUM",
    },
    "unusual_amount": {
        "key": "unusual_amount",
        "name": "Unusual amount",
        "description": "4 payments of about ₹1,000, then a ₹40,000 payment (balance ₹2,00,000).",
        "expected_level": "MEDIUM",
    },
    "impossible_travel": {
        "key": "impossible_travel",
        "name": "Impossible travel",
        "description": "A payment in Chennai 30 minutes ago, then a payment in Delhi now.",
        "expected_level": "HIGH",
    },
    "balance_drain": {
        "key": "balance_drain",
        "name": "Balance drain (cash-out)",
        "description": "3 payments of ₹2,500–₹3,500, then ₹8,500 with only ₹10,000 left in the account.",
        "expected_level": "MEDIUM",
    },
    "high_risk_merchant": {
        "key": "high_risk_merchant",
        "name": "High-risk merchant",
        "description": "3 normal payments, then ₹5,000 at CryptoXchange (rule fires, but stays LOW and is not flagged).",
        "expected_level": "LOW",
    },
    "fraud_ring": {
        "key": "fraud_ring",
        "name": "Fraud ring (shared device)",
        "description": "4 new customers each make one ₹1,000–₹1,500 payment, 20 minutes apart, all on the same device.",
        "expected_level": "MEDIUM",
    },
    "account_takeover": {
        "key": "account_takeover",
        "name": "Account takeover",
        "description": "3 × ₹2,000 in Mumbai 40 minutes apart, then ₹60,000 at QuickGiftCards in Delhi 40 minutes later with a ₹65,000 balance.",
        "expected_level": "CRITICAL",
    },
}


def list_scenarios() -> list[dict[str, str]]:
    """[{key, name, description, expected_level}] in display order."""
    return [dict(meta) for meta in SCENARIOS.values()]


# --------------------------------------------------------------------- helpers


def _digits_taken(db: Session, digits: str) -> bool:
    prefix = f"SIM-{digits}"
    stmt = (
        select(Transaction.id)
        .where(
            or_(
                Transaction.customer_id == prefix,
                Transaction.customer_id.like(f"{prefix}-%"),
                Transaction.transaction_id.like(f"{prefix}-%"),
                Transaction.device_id == f"SIMDEV-{digits}",
            )
        )
        .limit(1)
    )
    return db.execute(stmt).first() is not None


def _new_digits(db: Session, rng: random.Random) -> str:
    for _ in range(100):
        digits = f"{rng.randint(0, 9999):04d}"
        if not _digits_taken(db, digits):
            return digits
    raise RuntimeError("Could not find a free SIM-XXXX customer id; reset the data and try again")


class _Builder:
    """Collects rows for one scenario run with ids, balances and locations filled in."""

    def __init__(self, digits: str, now: datetime):
        self.digits = digits
        self.now = now
        self.rows: list[dict[str, Any]] = []
        self._balances: dict[str, float] = {}

    @property
    def customer(self) -> str:
        return f"SIM-{self.digits}"

    @property
    def device(self) -> str:
        return f"SIMDEV-{self.digits}"

    def start(self, customer_id: str, balance: float) -> None:
        self._balances[customer_id] = float(balance)

    def add(
        self,
        customer_id: str,
        amount: float,
        ago: timedelta,
        city: str,
        merchant: str,
        device_id: str | None = None,
    ) -> None:
        lat, lon = CITIES[city]
        balance = self._balances[customer_id]
        self.rows.append(
            {
                "customer_id": customer_id,
                "amount": float(amount),
                "currency": "INR",
                "merchant": merchant,
                "city": city,
                "latitude": lat,
                "longitude": lon,
                "timestamp": self.now - ago,
                "device_id": device_id or self.device,
                "account_balance": balance,
            }
        )
        self._balances[customer_id] = balance - float(amount)

    def finish(self) -> list[dict[str, Any]]:
        rows = sorted(self.rows, key=lambda r: r["timestamp"])  # stable: keeps insert order on ties
        for index, row in enumerate(rows, start=1):
            row["transaction_id"] = f"SIM-{self.digits}-{index:02d}"
        return rows


def _h(hours: float) -> timedelta:
    return timedelta(hours=hours)


def _m(minutes: float) -> timedelta:
    return timedelta(minutes=minutes)


# --------------------------------------------------------------------- scenarios


def _normal(b: _Builder) -> None:
    c = b.customer
    b.start(c, 50000)
    for amount, ago, merchant in (
        (450, _h(7.5), "Big Bazaar"),
        (1200, _h(5), "Apollo Pharmacy"),
        (300, _h(2.5), "Cafe Coffee Day"),
        (800, _h(0), "Reliance Digital"),
    ):
        b.add(c, amount, ago, "Chennai", merchant)


def _velocity(b: _Builder) -> None:
    c = b.customer
    b.start(c, 30000)
    # Earlier average 1,000; burst amounts stay far below 3x that, and far from the balance.
    for amount, ago, merchant in ((800, _h(6), "Big Bazaar"), (1000, _h(4), "Apollo Pharmacy"), (1200, _h(2), "Lifestyle")):
        b.add(c, amount, ago, "Bengaluru", merchant)
    burst = (199, 249, 149, 299, 99, 349)
    for i, amount in enumerate(burst):
        seconds = 90 * (len(burst) - 1 - i)  # 450 s ago ... now
        b.add(c, amount, timedelta(seconds=seconds), "Bengaluru", "Swiggy" if i % 2 == 0 else "Zomato")


def _unusual_amount(b: _Builder) -> None:
    c = b.customer
    b.start(c, 200000)
    for amount, ago, merchant in (
        (1000, _h(12), "Big Bazaar"),
        (1200, _h(9), "Apollo Pharmacy"),
        (800, _h(6), "Cafe Coffee Day"),
        (1000, _h(3), "Lifestyle"),
        (40000, _h(0), "Croma"),
    ):
        b.add(c, amount, ago, "Hyderabad", merchant)


def _impossible_travel(b: _Builder) -> None:
    c = b.customer
    b.start(c, 30000)
    b.add(c, 1500, _m(30), "Chennai", "Big Bazaar")
    b.add(c, 1800, _m(0), "Delhi", "Lifestyle")


def _balance_drain(b: _Builder) -> None:
    c = b.customer
    b.start(c, 19000)
    # Average 3,000 -> 8,500 is 2.83x (below 3x), but 85% of the 10,000 balance.
    for amount, ago, merchant in (
        (3000, _h(6), "Big Bazaar"),
        (2500, _h(4), "Apollo Pharmacy"),
        (3500, _h(2), "Lifestyle"),
        (8500, _h(0), "Reliance Digital"),
    ):
        b.add(c, amount, ago, "Kolkata", merchant)


def _high_risk_merchant(b: _Builder) -> None:
    c = b.customer
    b.start(c, 50000)
    # Average 2,000 -> 5,000 is 2.5x (below 3x) and ~11% of the balance.
    for amount, ago, merchant in (
        (2000, _h(6), "Big Bazaar"),
        (2500, _h(4), "Apollo Pharmacy"),
        (1500, _h(2), "Lifestyle"),
        (5000, _h(0), "CryptoXchange"),
    ):
        b.add(c, amount, ago, "Pune", merchant)


def _fraud_ring(b: _Builder) -> None:
    members = (("A", 1200, 25000), ("B", 1500, 18000), ("C", 1300, 22000), ("D", 1400, 30000))
    for i, (suffix, amount, balance) in enumerate(members):
        customer = f"SIM-{b.digits}-{suffix}"
        b.start(customer, balance)
        minutes = 20 * (len(members) - 1 - i)  # 60, 40, 20, 0 min ago
        b.add(customer, amount, _m(minutes), "Hyderabad", "Amazon Pay", device_id=b.device)


def _account_takeover(b: _Builder) -> None:
    c = b.customer
    b.start(c, 71000)
    b.add(c, 2000, _m(120), "Mumbai", "Big Bazaar")
    b.add(c, 2000, _m(80), "Mumbai", "Apollo Pharmacy")
    b.add(c, 2000, _m(40), "Mumbai", "Cafe Coffee Day")
    b.add(c, 60000, _m(0), "Delhi", "QuickGiftCards")


_BUILDERS: dict[str, Callable[[_Builder], None]] = {
    "normal": _normal,
    "velocity": _velocity,
    "unusual_amount": _unusual_amount,
    "impossible_travel": _impossible_travel,
    "balance_drain": _balance_drain,
    "high_risk_merchant": _high_risk_merchant,
    "fraud_ring": _fraud_ring,
    "account_takeover": _account_takeover,
}


def build_rows(scenario: str, digits: str, now: datetime | None = None) -> list[dict[str, Any]]:
    """Rows (TransactionIn-shaped dicts, datetime timestamps) for one scenario, oldest first."""
    if scenario not in _BUILDERS:
        raise ValueError(f"Unknown scenario '{scenario}' (allowed: {', '.join(SCENARIOS)})")
    now = (now or datetime.now()).replace(microsecond=0)
    builder = _Builder(digits, now)
    _BUILDERS[scenario](builder)
    return builder.finish()


def _level_value(level: Any) -> str:
    try:
        return RiskLevel(str(getattr(level, "value", level))).value
    except ValueError:
        return str(level)


# --------------------------------------------------------------------- run


def run_scenario(db: Session, engine, bus, scenario: str, actor_id: int | None = None) -> dict[str, Any]:
    """Generate and ingest one scenario. Raises ValueError for an unknown scenario."""
    if scenario not in SCENARIOS:
        raise ValueError(f"Unknown scenario '{scenario}' (allowed: {', '.join(SCENARIOS)})")

    from app.schemas import TransactionIn  # lazy: written by another module
    from app.services.ingest import ingest_transaction

    digits = _new_digits(db, random.SystemRandom())
    rows = build_rows(scenario, digits)

    customer_ids: list[str] = []
    transactions: list[dict[str, Any]] = []
    for row in rows:
        if row["customer_id"] not in customer_ids:
            customer_ids.append(row["customer_id"])
        data = dict(row, timestamp=row["timestamp"].isoformat())
        payload = TransactionIn.model_validate(data)
        result = ingest_transaction(db, engine, bus, payload, source=SOURCE, actor_id=actor_id)
        transactions.append(
            {
                "transaction_id": row["transaction_id"],
                "customer_id": row["customer_id"],
                "score": int(result.score),
                "level": _level_value(result.level),
                "flag_id": result.flag_id,
            }
        )

    summary = {
        "processed": len(transactions),
        "flagged": sum(1 for t in transactions if t["flag_id"] is not None),
        "max_level": _level_value(max_level(t["level"] for t in transactions)) if transactions else None,
    }
    bus.publish(
        SimulationRun(scenario=scenario, customer_ids=list(customer_ids), user_id=actor_id, summary=summary),
        db,
    )
    return {"scenario": scenario, "customer_ids": customer_ids, "transactions": transactions}
