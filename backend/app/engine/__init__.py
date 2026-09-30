"""Rule engine: contract, discovery, evaluation, scoring and geo helpers (plan Section 7)."""

from app.engine.base import FraudRule, RuleContext, RuleResult, format_duration, format_inr
from app.engine.engine import RuleEngine, effective_params, rule_meta, validate_params
from app.engine.geo import haversine_km
from app.engine.registry import discover_rules
from app.engine.scoring import raw_score, risk_level, total_score

__all__ = [
    "FraudRule",
    "RuleContext",
    "RuleResult",
    "RuleEngine",
    "discover_rules",
    "effective_params",
    "rule_meta",
    "validate_params",
    "format_duration",
    "format_inr",
    "haversine_km",
    "raw_score",
    "risk_level",
    "total_score",
]
