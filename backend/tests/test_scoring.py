"""Scoring: total/raw score and risk levels (plan Sections 5 and 7.5)."""

from __future__ import annotations

import pytest

from app.engine.base import RuleResult
from app.engine.scoring import MAX_SCORE, raw_score, risk_level, total_score
from app.enums import RiskLevel


@pytest.mark.parametrize(
    ("score", "level"),
    [
        (0, RiskLevel.LOW),
        (24, RiskLevel.LOW),
        (25, RiskLevel.MEDIUM),
        (49, RiskLevel.MEDIUM),
        (50, RiskLevel.HIGH),
        (74, RiskLevel.HIGH),
        (75, RiskLevel.CRITICAL),
        (100, RiskLevel.CRITICAL),
    ],
)
def test_level_boundaries(score, level):
    assert risk_level(score) == level
    assert risk_level(score) == level.value


def test_cap_at_100_keeps_raw_score():
    # T020: unusual_amount 30 + impossible_travel 50 + high_risk_merchant 20 + balance_drain 25
    results = [
        RuleResult("unusual_amount", True, "fired", score=30),
        RuleResult("impossible_travel", True, "fired", score=50),
        RuleResult("high_risk_merchant", True, "fired", score=20),
        RuleResult("balance_drain", True, "fired", score=25),
        RuleResult("velocity", False, "Passed: ...", score=0),
    ]
    assert raw_score(results) == 125
    assert total_score(results) == 100 == MAX_SCORE
    assert risk_level(total_score(results)) == RiskLevel.CRITICAL


def test_only_triggered_results_count():
    results = [
        RuleResult("velocity", True, "fired", score=30),
        RuleResult("unusual_amount", False, "Passed: ...", score=30),  # defensive: ignored
    ]
    assert raw_score(results) == 30
    assert total_score(results) == 30
    assert risk_level(total_score(results)) == RiskLevel.MEDIUM


def test_no_results_scores_zero():
    assert raw_score([]) == 0
    assert total_score([]) == 0
    assert risk_level(0) == RiskLevel.LOW


def test_single_high_signal_reaches_high():
    results = [RuleResult("impossible_travel", True, "fired", score=50)]
    assert total_score(results) == 50
    assert risk_level(total_score(results)) == RiskLevel.HIGH


def test_watchlist_alone_stays_low():
    results = [RuleResult("high_risk_merchant", True, "fired", score=20)]
    assert risk_level(total_score(results)) == RiskLevel.LOW
