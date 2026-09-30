"""Scoring (plan Section 7.5): total score, raw score and risk level."""

from __future__ import annotations

from collections.abc import Iterable

from app.enums import LEVEL_THRESHOLDS, RiskLevel, risk_level_from_score

MAX_SCORE = 100

__all__ = ["MAX_SCORE", "LEVEL_THRESHOLDS", "raw_score", "total_score", "risk_level"]


def raw_score(results: Iterable) -> int:
    """Uncapped sum of the scores of fired results (shown in the score breakdown)."""
    return int(sum(int(r.score or 0) for r in results if r.triggered))


def total_score(results: Iterable) -> int:
    """min(100, raw score)."""
    return max(0, min(MAX_SCORE, raw_score(results)))


def risk_level(score: int | float) -> RiskLevel:
    """0-24 LOW, 25-49 MEDIUM, 50-74 HIGH, 75-100 CRITICAL."""
    return risk_level_from_score(score)
