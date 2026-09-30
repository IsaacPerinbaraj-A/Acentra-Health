"""Rule engine (plan Section 7.4).

    engine = RuleEngine(discover_rules("app.rules"))
    results = engine.evaluate(txn, RuleContext(history, db), load_rule_configs(db))

``configs`` maps rule name -> anything with ``.enabled``, ``.score`` and
``.params`` (a RuleConfig row, a SimpleNamespace) or a dict with those keys.
A rule without a config runs with its defaults. Effective params are
``{**rule.default_params, **config.params}``.
"""

from __future__ import annotations

import copy
import logging
from collections.abc import Mapping
from typing import Any

from app.engine.base import FraudRule, RuleContext, RuleResult

logger = logging.getLogger(__name__)

__all__ = [
    "RuleEngine",
    "config_value",
    "effective_params",
    "rule_meta",
    "validate_params",
]

_MISSING = object()


def config_value(config: Any, key: str, default: Any = None) -> Any:
    """Read `key` from a RuleConfig-like object or a dict; `default` if absent/None."""
    if config is None:
        return default
    if isinstance(config, Mapping):
        value = config.get(key, _MISSING)
    else:
        value = getattr(config, key, _MISSING)
    return default if value is _MISSING or value is None else value


def effective_params(rule: FraudRule | type[FraudRule], config: Any = None) -> dict:
    """{**default_params, **(config.params or {})} as a fresh (deep-copied) dict."""
    params = copy.deepcopy(dict(rule.default_params or {}))
    params.update(copy.deepcopy(dict(config_value(config, "params", {}) or {})))
    return params


def rule_meta(rule: FraudRule | type[FraudRule]) -> dict[str, Any]:
    """Static metadata of a rule class/instance (for /api/rules and result rows)."""
    cls = rule if isinstance(rule, type) else type(rule)
    return {
        "name": cls.name,
        "display_name": getattr(cls, "display_name", None) or cls.name.replace("_", " ").capitalize(),
        "description": getattr(cls, "description", "") or "",
        "default_score": int(getattr(cls, "default_score", 0) or 0),
        "default_params": copy.deepcopy(dict(getattr(cls, "default_params", {}) or {})),
        # API contract: e.g. "app/rules/velocity.py"
        "module": cls.__module__.replace(".", "/") + ".py",
    }


def _json_kind(value: Any) -> str:
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (list, tuple)):
        return "list"
    if isinstance(value, dict):
        return "object"
    if value is None:
        return "null"
    return type(value).__name__


def validate_params(default_params: Mapping[str, Any], params: Mapping[str, Any]) -> dict:
    """Check `params` against a rule's defaults (used by PATCH /api/rules and backtest).

    Every key must exist in `default_params` and keep the same JSON type (numbers
    stay numbers - int/float interchangeable, bools stay bools, lists stay lists,
    strings stay strings). List items must be strings when the default list holds
    strings. Raises ValueError with a readable message; returns a clean copy.
    """
    if not isinstance(params, Mapping):
        raise ValueError("params must be an object")
    clean: dict[str, Any] = {}
    for key, value in params.items():
        if key not in default_params:
            allowed = ", ".join(sorted(default_params)) or "none"
            raise ValueError(f"Unknown parameter '{key}' (allowed: {allowed})")
        default = default_params[key]
        want, got = _json_kind(default), _json_kind(value)
        if want != got:
            raise ValueError(f"Parameter '{key}' must be a {want}, got {got}")
        if want == "list":
            value = list(value)
            if default and all(isinstance(v, str) for v in default):
                if not all(isinstance(v, str) for v in value):
                    raise ValueError(f"Parameter '{key}' must be a list of strings")
        clean[key] = copy.deepcopy(value)
    return clean


class RuleEngine:
    """Runs every registered rule. Rule classes are instantiated once."""

    def __init__(self, rules: Mapping[str, type[FraudRule]]):
        self.rules: dict[str, FraudRule] = {
            name: (cls() if isinstance(cls, type) else cls) for name, cls in sorted(rules.items())
        }

    # ------------------------------------------------------------ metadata
    @property
    def names(self) -> list[str]:
        return sorted(self.rules)

    def get(self, name: str) -> FraudRule | None:
        return self.rules.get(name)

    def meta(self, name: str) -> dict[str, Any]:
        """rule_meta() of a registered rule; a readable fallback for unknown names."""
        rule = self.rules.get(name)
        if rule is not None:
            return rule_meta(rule)
        return {
            "name": name,
            "display_name": name.replace("_", " ").capitalize(),
            "description": "",
            "default_score": 0,
            "default_params": {},
            "module": None,
        }

    def display_name(self, name: str) -> str:
        return self.meta(name)["display_name"]

    def description(self, name: str) -> str:
        return self.meta(name)["description"]

    # ------------------------------------------------------------ evaluation
    def evaluate(
        self,
        txn: Any,
        ctx: RuleContext,
        configs: Mapping[str, Any] | None = None,
    ) -> list[RuleResult]:
        """Run every enabled rule in name order. A failing rule never breaks the others."""
        configs = configs or {}
        results: list[RuleResult] = []
        for name in sorted(self.rules):
            rule = self.rules[name]
            config = configs.get(name)
            if not bool(config_value(config, "enabled", True)):
                continue
            score = int(config_value(config, "score", rule.default_score))
            try:
                params = effective_params(rule, config)
                result = rule.evaluate(txn, ctx, params)
                if not isinstance(result, RuleResult):
                    raise TypeError(f"evaluate() returned {type(result).__name__}, not RuleResult")
            except Exception as exc:  # noqa: BLE001
                logger.exception("Rule %s failed on %s", name, getattr(txn, "transaction_id", txn))
                result = RuleResult(name, False, f"Rule error: {exc}", {"error": str(exc)})
            result.rule_name = name
            result.triggered = bool(result.triggered)
            if not result.reason:
                result.reason = "Fired" if result.triggered else "Passed"
            if result.details is None:
                result.details = {}
            result.score = score if result.triggered else 0
            results.append(result)
        return results
