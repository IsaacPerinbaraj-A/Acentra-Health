"""Rule backtesting and rule performance (plan Section 18)."""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.enums import FlagStatus
from app.models import FraudFlag, RuleConfig, RuleResult, Transaction
from app.services.backtest import rule_performance, run_backtest

DEMO_CURRENT = {"flagged": 9, "by_level": {"MEDIUM": 7, "HIGH": 1, "CRITICAL": 1}}


def _snapshot(db):
    return {
        "transactions": db.scalar(select(func.count(Transaction.id))),
        "flags": db.scalar(select(func.count(FraudFlag.id))),
        "results": db.scalar(select(func.count(RuleResult.id))),
        "levels": dict(db.execute(select(Transaction.transaction_id, Transaction.risk_level)).all()),
        "configs": {
            r.rule_name: (r.enabled, r.score, dict(r.params or {})) for r in db.scalars(select(RuleConfig))
        },
    }


def test_backtest_without_overrides_matches_stored_flags(db, engine, demo_loaded):
    out = run_backtest(db, engine, {})
    assert set(out) == {"current", "simulated", "newly_flagged", "no_longer_flagged"}
    assert out["current"] == DEMO_CURRENT
    assert out["simulated"] == DEMO_CURRENT
    assert out["newly_flagged"] == []
    assert out["no_longer_flagged"] == []


def test_backtest_lower_multiplier_flags_t004_and_changes_nothing(db, engine, demo_loaded):
    before = _snapshot(db)
    out = run_backtest(db, engine, {"unusual_amount": {"params": {"multiplier": 2.0}}})

    assert out["current"] == DEMO_CURRENT
    # T004: 1,500 vs average 650 (2.3x) now fires; T028 (2.83x) moves MEDIUM -> HIGH.
    assert out["newly_flagged"] == ["T004"]
    assert out["no_longer_flagged"] == []
    assert out["simulated"] == {"flagged": 10, "by_level": {"MEDIUM": 7, "HIGH": 2, "CRITICAL": 1}}

    db.expire_all()
    assert _snapshot(db) == before
    t004 = db.scalar(select(Transaction).where(Transaction.transaction_id == "T004"))
    assert t004.risk_level == "LOW"
    assert t004.flag is None


def test_backtest_disabling_impossible_travel(db, engine, demo_loaded):
    out = run_backtest(db, engine, {"impossible_travel": {"enabled": False}})
    # T016 drops to 0; T020 stays CRITICAL (30 + 20 + 25 = 75).
    assert out["no_longer_flagged"] == ["T016"]
    assert out["newly_flagged"] == []
    assert out["simulated"] == {"flagged": 8, "by_level": {"MEDIUM": 7, "HIGH": 0, "CRITICAL": 1}}


@pytest.mark.parametrize(
    "overrides",
    [
        {"no_such_rule": {"enabled": False}},
        {"velocity": {"score": 150}},
        {"velocity": {"params": {"bogus": 1}}},
        {"velocity": {"params": {"max_transactions": "five"}}},
    ],
)
def test_backtest_rejects_invalid_overrides(db, engine, demo_loaded, overrides):
    with pytest.raises(ValueError):
        run_backtest(db, engine, overrides)


def test_rule_performance_counts(db, rules, demo_loaded):
    flag = db.scalar(
        select(FraudFlag).join(Transaction, FraudFlag.transaction_pk == Transaction.id).where(
            Transaction.transaction_id == "T016"
        )
    )
    flag.status = FlagStatus.CLEARED.value
    db.commit()

    perf = {row["rule_name"]: row for row in rule_performance(db, rules)}
    assert set(perf) == set(rules)
    for row in perf.values():
        assert set(row) == {
            "rule_name",
            "display_name",
            "fired_on_flags",
            "pending",
            "reviewed",
            "cleared",
            "confirmed_fraud",
            "clear_rate",
        }

    travel = perf["impossible_travel"]
    assert (travel["fired_on_flags"], travel["pending"], travel["cleared"], travel["confirmed_fraud"]) == (2, 1, 1, 0)
    assert travel["clear_rate"] == 1.0
    assert travel["display_name"] == "Impossible travel"

    assert perf["velocity"]["fired_on_flags"] == 2
    assert perf["velocity"]["pending"] == 2
    assert perf["velocity"]["clear_rate"] is None
    assert perf["unusual_amount"]["fired_on_flags"] == 3
    assert perf["balance_drain"]["fired_on_flags"] == 2
    assert perf["shared_device"]["fired_on_flags"] == 2
    # T022 fired high_risk_merchant but was not flagged, so only T020 counts.
    assert perf["high_risk_merchant"]["fired_on_flags"] == 1
