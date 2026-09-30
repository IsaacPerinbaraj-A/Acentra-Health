"""Rule builder: create simple condition rules from the console.

A rule created here is written as a normal rule file in ``app/rules/`` (one file
per rule, exactly like the hand-written ones), then the rules are re-discovered
and the engine is rebuilt, so the new rule runs on the next transaction without
a restart. The engine itself is unchanged.

Only whitelisted fields and operators are accepted, and every user-supplied
value is written with ``repr()`` of a validated str/float, so no user text can
become code.
"""
from __future__ import annotations

import importlib
import re
import sys
from pathlib import Path
from typing import Any

import app.rules as rules_package
from app.engine.base import FraudRule, RuleResult, format_inr

RULES_DIR = Path(rules_package.__file__).parent
CUSTOM_PREFIX = "custom_"
NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,40}$")

NUMERIC_FIELDS = {"amount": "Amount", "account_balance": "Account balance"}
TEXT_FIELDS = {
    "merchant": "Merchant",
    "city": "City",
    "device_id": "Device id",
    "customer_id": "Customer id",
    "currency": "Currency",
}
FIELDS = {**NUMERIC_FIELDS, **TEXT_FIELDS}

NUMERIC_OPS = {"gte": "≥", "gt": ">", "lte": "≤", "lt": "<", "eq": "=", "neq": "≠"}
TEXT_OPS = {"eq": "equals", "neq": "does not equal", "contains": "contains", "in": "is one of"}


def _fmt(field: str, value: Any) -> str:
    if field in NUMERIC_FIELDS:
        return format_inr(float(value))
    return f"'{value}'"


def evaluate_condition(rule: FraudRule, txn: Any, params: dict) -> RuleResult:
    """Shared evaluator used by every generated rule file."""
    field, op, target = params.get("field"), params.get("operator"), params.get("value")
    label = FIELDS.get(field, field)
    actual = getattr(txn, field, None)
    if actual is None or actual == "":
        return RuleResult(rule.name, False, f"Skipped: {label.lower()} not provided", {"field": field})

    if field in NUMERIC_FIELDS:
        try:
            a, t = float(actual), float(target)
        except (TypeError, ValueError):
            return RuleResult(rule.name, False, f"Skipped: invalid value for {label.lower()}", {"field": field})
        checks = {"gte": a >= t, "gt": a > t, "lte": a <= t, "lt": a < t, "eq": a == t, "neq": a != t}
        hit = checks.get(op, False)
        sym = NUMERIC_OPS.get(op, op)
    else:
        a = str(actual).strip().lower()
        options = [s.strip().lower() for s in str(target).split(",") if s.strip()]
        t = str(target).strip().lower()
        checks = {"eq": a == t, "neq": a != t, "contains": t in a, "in": a in options}
        hit = checks.get(op, False)
        sym = TEXT_OPS.get(op, op)

    condition = f"{label} {sym} {_fmt(field, target)}"
    details = {"field": field, "operator": op, "value": target, "actual": actual}
    if hit:
        return RuleResult(rule.name, True, f"{label} {_fmt(field, actual)} matches: {condition}", details)
    return RuleResult(rule.name, False, f"Passed: {label.lower()} {_fmt(field, actual)} does not match {condition}", details)


TEMPLATE = '''"""Custom rule created in the RiskLens console (rule builder).

Edit the params on the Rules page, or delete this file to remove the rule.
"""
from app.engine.base import FraudRule
from app.services.rule_builder import evaluate_condition


class {class_name}(FraudRule):
    name = {name!r}
    display_name = {display_name!r}
    description = {description!r}
    default_score = {score!r}
    default_params = {{"field": {field!r}, "operator": {operator!r}, "value": {value!r}}}

    def evaluate(self, txn, ctx, params):
        return evaluate_condition(self, txn, params)
'''


def validate_spec(spec: dict, existing: set[str]) -> dict:
    """Validate a create-rule request; raise ValueError with a readable message."""
    name = str(spec.get("name") or "").strip().lower()
    if not NAME_RE.match(name):
        raise ValueError("Rule id must be 3-41 characters: lowercase letters, digits and underscores, starting with a letter")
    if name in existing:
        raise ValueError(f"A rule named '{name}' already exists")
    display_name = str(spec.get("display_name") or "").strip()[:80]
    if not display_name:
        raise ValueError("Display name is required")
    description = str(spec.get("description") or "").strip()[:240] or f"Custom condition rule: {display_name}."
    try:
        score = int(spec.get("score", 20))
    except (TypeError, ValueError):
        raise ValueError("Points must be a whole number") from None
    if not 0 <= score <= 100:
        raise ValueError("Points must be between 0 and 100")
    field = spec.get("field")
    if field not in FIELDS:
        raise ValueError(f"Field must be one of: {', '.join(FIELDS)}")
    operator = spec.get("operator")
    ops = NUMERIC_OPS if field in NUMERIC_FIELDS else TEXT_OPS
    if operator not in ops:
        raise ValueError(f"Operator for {field} must be one of: {', '.join(ops)}")
    value = spec.get("value")
    if field in NUMERIC_FIELDS:
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise ValueError("Value must be a number for this field") from None
        if value == int(value):
            value = int(value)
    else:
        value = str(value or "").strip()[:200]
        if not value:
            raise ValueError("Value is required")
    return {"name": name, "display_name": display_name, "description": description,
            "score": score, "field": field, "operator": operator, "value": value}


def write_rule_file(spec: dict) -> Path:
    class_name = "".join(p.capitalize() for p in spec["name"].split("_")) + "Rule"
    path = RULES_DIR / f"{CUSTOM_PREFIX}{spec['name']}.py"
    path.write_text(TEMPLATE.format(class_name=class_name, **spec), encoding="utf-8")
    return path


def delete_rule_file(name: str) -> bool:
    path = RULES_DIR / f"{CUSTOM_PREFIX}{name}.py"
    if not path.exists():
        return False
    path.unlink()
    sys.modules.pop(f"{rules_package.__name__}.{CUSTOM_PREFIX}{name}", None)
    return True


def is_custom(cls: Any) -> bool:
    return cls.__module__.rsplit(".", 1)[-1].startswith(CUSTOM_PREFIX)


def reload_rules(fastapi_app, db) -> dict:
    """Re-discover rules, sync configs and swap the engine on app.state (no restart)."""
    from app.engine.engine import RuleEngine
    from app.engine.registry import discover_rules
    from app.seed import sync_rule_configs

    importlib.invalidate_caches()
    rules = discover_rules(rules_package)
    sync_rule_configs(db, rules)
    fastapi_app.state.rules = rules
    fastapi_app.state.engine = RuleEngine(rules)
    return rules


OPTIONS = {
    "fields": [{"value": k, "label": v, "type": "number" if k in NUMERIC_FIELDS else "text"} for k, v in FIELDS.items()],
    "numeric_operators": [{"value": k, "label": v} for k, v in NUMERIC_OPS.items()],
    "text_operators": [{"value": k, "label": v} for k, v in TEXT_OPS.items()],
}
