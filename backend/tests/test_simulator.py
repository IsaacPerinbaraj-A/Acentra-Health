"""Simulator scenarios (plan Section 17)."""

from __future__ import annotations

import re
from datetime import datetime

import pytest
from sqlalchemy import select

from app.models import FraudFlag, RuleResult, Transaction
from app.services.simulator import SCENARIOS, build_rows, list_scenarios, run_scenario

# scenario -> expected (score, level) per transaction, oldest first
EXPECTED: dict[str, list[tuple[int, str]]] = {
    "normal": [(0, "LOW")] * 4,
    "velocity": [(0, "LOW")] * 7 + [(30, "MEDIUM")] * 2,
    "unusual_amount": [(0, "LOW")] * 4 + [(30, "MEDIUM")],
    "impossible_travel": [(0, "LOW"), (50, "HIGH")],
    "balance_drain": [(0, "LOW")] * 3 + [(25, "MEDIUM")],
    "high_risk_merchant": [(0, "LOW")] * 3 + [(20, "LOW")],
    "fraud_ring": [(0, "LOW")] * 2 + [(40, "MEDIUM")] * 2,
    "account_takeover": [(0, "LOW")] * 3 + [(100, "CRITICAL")],
}

# scenario -> rules expected to fire on the last transaction
FIRED_ON_LAST: dict[str, set[str]] = {
    "normal": set(),
    "velocity": {"velocity"},
    "unusual_amount": {"unusual_amount"},
    "impossible_travel": {"impossible_travel"},
    "balance_drain": {"balance_drain"},
    "high_risk_merchant": {"high_risk_merchant"},
    "fraud_ring": {"shared_device"},
    "account_takeover": {"unusual_amount", "impossible_travel", "high_risk_merchant", "balance_drain"},
}


def test_list_scenarios_has_eight_entries():
    scenarios = list_scenarios()
    assert [s["key"] for s in scenarios] == list(EXPECTED)
    for s in scenarios:
        assert set(s) == {"key", "name", "description", "expected_level"}
        assert s["expected_level"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
    assert set(SCENARIOS) == set(EXPECTED)


@pytest.mark.parametrize("scenario", list(EXPECTED))
def test_rows_are_ordered_consistent_and_not_in_future(scenario):
    now = datetime(2026, 9, 30, 12, 0, 0)
    rows = build_rows(scenario, "1234", now=now)
    timestamps = [r["timestamp"] for r in rows]
    assert timestamps == sorted(timestamps)
    assert all(ts <= now for ts in timestamps)
    assert timestamps[-1] == now
    assert [r["transaction_id"] for r in rows] == [f"SIM-1234-{i:02d}" for i in range(1, len(rows) + 1)]
    last_balance: dict[str, tuple[float, float]] = {}
    for r in rows:
        prev = last_balance.get(r["customer_id"])
        if prev is not None:
            assert r["account_balance"] == pytest.approx(prev[0] - prev[1])
        last_balance[r["customer_id"]] = (r["account_balance"], r["amount"])
        assert r["account_balance"] >= r["amount"]


def test_unknown_scenario_raises(db, engine, bus):
    with pytest.raises(ValueError):
        run_scenario(db, engine, bus, "nope")


@pytest.mark.parametrize("scenario", list(EXPECTED))
def test_scenario_outcomes(db, engine, bus, scenario):
    before = datetime.now().replace(microsecond=0)
    out = run_scenario(db, engine, bus, scenario)

    assert out["scenario"] == scenario
    txns = out["transactions"]
    assert [(t["score"], t["level"]) for t in txns] == EXPECTED[scenario]
    for t in txns:
        assert (t["flag_id"] is not None) == (t["level"] != "LOW")
        assert re.fullmatch(r"SIM-\d{4}-\d{2}", t["transaction_id"])

    if scenario == "fraud_ring":
        assert len(out["customer_ids"]) == 4
        assert all(re.fullmatch(r"SIM-\d{4}-[ABCD]", c) for c in out["customer_ids"])
    else:
        assert len(out["customer_ids"]) == 1
        assert re.fullmatch(r"SIM-\d{4}", out["customer_ids"][0])
    assert {t["customer_id"] for t in txns} == set(out["customer_ids"])

    rows = {
        r.transaction_id: r
        for r in db.scalars(select(Transaction).where(Transaction.transaction_id.in_([t["transaction_id"] for t in txns])))
    }
    assert len(rows) == len(txns)
    after = datetime.now()
    assert all(r.timestamp <= after for r in rows.values())
    assert max(r.timestamp for r in rows.values()) >= before
    if scenario == "fraud_ring":
        assert len({r.device_id for r in rows.values()}) == 1
        assert next(iter(rows.values())).device_id.startswith("SIMDEV-")

    last = rows[txns[-1]["transaction_id"]]
    fired = set(
        db.scalars(select(RuleResult.rule_name).where(RuleResult.transaction_pk == last.id, RuleResult.triggered.is_(True)))
    )
    assert fired == FIRED_ON_LAST[scenario]

    names = [e["name"] for e in bus.recent(500)]
    assert "SimulationRun" in names


def test_two_runs_use_different_customers(db, engine, bus):
    a = run_scenario(db, engine, bus, "normal")
    b = run_scenario(db, engine, bus, "normal")
    assert a["customer_ids"] != b["customer_ids"]
    ids = [t["transaction_id"] for t in a["transactions"] + b["transactions"]]
    pks = select(Transaction.id).where(Transaction.transaction_id.in_(ids))
    assert db.scalar(select(FraudFlag.id).where(FraudFlag.transaction_pk.in_(pks)).limit(1)) is None
