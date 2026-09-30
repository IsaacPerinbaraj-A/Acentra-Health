"""Enums shared by the whole backend (plan Section 5).

All enums are ``StrEnum`` (a ``str`` subclass), so ``RiskLevel.HIGH == "HIGH"``,
f-strings print the bare value and Pydantic/JSON serialise them as plain strings.
The database stores the plain string values.

Levels must be compared by their position in ``RiskLevel`` (``level_rank`` /
``level_gte``), never by string comparison ("HIGH" < "LOW" alphabetically!).
"""

from __future__ import annotations

from enum import StrEnum


class RiskLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class FlagStatus(StrEnum):
    PENDING_REVIEW = "PENDING_REVIEW"
    REVIEWED = "REVIEWED"
    CLEARED = "CLEARED"
    CONFIRMED_FRAUD = "CONFIRMED_FRAUD"


class Role(StrEnum):
    ADMIN = "ADMIN"
    REVIEWER = "REVIEWER"
    VIEWER = "VIEWER"


class NotificationStatus(StrEnum):
    SENT = "SENT"
    FAILED = "FAILED"
    LOGGED = "LOGGED"


class NotifyMode(StrEnum):
    LOG = "log"
    SNS = "sns"
    SES = "ses"


# Levels in ascending order of severity (the enum definition order).
LEVEL_ORDER: tuple[RiskLevel, ...] = tuple(RiskLevel)

# Inclusive lower bound of each level's score band (Section 5).
LEVEL_THRESHOLDS: dict[RiskLevel, int] = {
    RiskLevel.LOW: 0,
    RiskLevel.MEDIUM: 25,
    RiskLevel.HIGH: 50,
    RiskLevel.CRITICAL: 75,
}


def level_rank(level: RiskLevel | str) -> int:
    """Position of `level` in RiskLevel (LOW=0 ... CRITICAL=3). Accepts enum or string."""
    return LEVEL_ORDER.index(RiskLevel(level))


def level_gte(a: RiskLevel | str, b: RiskLevel | str) -> bool:
    """True if level `a` is at least as severe as level `b`."""
    return level_rank(a) >= level_rank(b)


def max_level(levels) -> RiskLevel | None:
    """Most severe level in an iterable of levels (None when empty / all None)."""
    present = [RiskLevel(lv) for lv in levels if lv]
    if not present:
        return None
    return max(present, key=level_rank)


def risk_level_from_score(score: int | float) -> RiskLevel:
    """Map a 0-100 score to its level using the inclusive lower bounds of Section 5."""
    result = RiskLevel.LOW
    for level in LEVEL_ORDER:
        if score >= LEVEL_THRESHOLDS[level]:
            result = level
    return result
