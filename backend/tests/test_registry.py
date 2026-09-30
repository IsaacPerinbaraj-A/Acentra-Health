"""Rule auto-discovery and engine behaviour (plan Sections 7.2 and 7.4)."""

from __future__ import annotations

import importlib
import sys
import textwrap
import uuid
from dataclasses import dataclass
from datetime import datetime
from types import SimpleNamespace

import pytest

import app.rules
from app.engine.base import FraudRule, RuleContext, RuleResult
from app.engine.engine import RuleEngine
from app.engine.registry import discover_rules

SIX_RULES = {
    "velocity",
    "unusual_amount",
    "impossible_travel",
    "balance_drain",
    "high_risk_merchant",
    "shared_device",
}

NEW_DEVICE_RULE = '''
from app.engine.base import FraudRule, RuleResult


class NewDeviceRule(FraudRule):
    name = "new_device"
    display_name = "New device"
    description = "Fires when a customer with history uses a device never seen before."
    default_score = 20
    default_params = {"min_history": 3}

    def evaluate(self, txn, ctx, params):
        if len(ctx.history) < params["min_history"] or not txn.device_id:
            return RuleResult(self.name, False, "Passed: not enough history or no device id")
        seen = {t.device_id for t in ctx.history if t.device_id}
        if txn.device_id in seen:
            return RuleResult(self.name, False, f"Passed: device {txn.device_id} seen before")
        return RuleResult(self.name, True, f"New device {txn.device_id} (known: {len(seen)})",
                          {"device_id": txn.device_id, "known_devices": sorted(seen)})
'''


@dataclass
class Txn:
    transaction_id: str = "T1"
    customer_id: str = "C1"
    amount: float = 1000.0
    currency: str = "INR"
    merchant: str | None = "QuickGiftCards"
    city: str | None = "Chennai"
    latitude: float | None = 13.0827
    longitude: float | None = 80.2707
    timestamp: datetime = datetime(2026, 10, 1, 12, 0)
    device_id: str | None = "D-NEW"
    account_balance: float | None = 50000.0


def _make_package(tmp_path, monkeypatch, files: dict[str, str]):
    """Create an importable package with the given modules in tmp_path; return it."""
    pkg_name = f"tmp_rules_{uuid.uuid4().hex[:8]}"
    pkg_dir = tmp_path / pkg_name
    pkg_dir.mkdir()
    (pkg_dir / "__init__.py").write_text("", encoding="utf-8")
    for mod_name, source in files.items():
        (pkg_dir / f"{mod_name}.py").write_text(textwrap.dedent(source), encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))
    importlib.invalidate_caches()
    pkg = importlib.import_module(pkg_name)
    return pkg


@pytest.fixture(autouse=True)
def _cleanup_tmp_packages():
    before = set(sys.modules)
    yield
    for name in set(sys.modules) - before:
        if name.startswith("tmp_rules_"):
            sys.modules.pop(name, None)


# ---------------------------------------------------------------- discovery


def test_all_six_rules_discovered():
    rules = discover_rules(app.rules)
    assert set(rules) == SIX_RULES
    for name, cls in rules.items():
        assert issubclass(cls, FraudRule)
        assert cls.name == name
        assert cls.display_name
        assert cls.description
        assert isinstance(cls.default_score, int)
        assert isinstance(cls.default_params, dict)


def test_discover_accepts_package_name():
    assert set(discover_rules("app.rules")) == SIX_RULES


def test_new_rule_file_is_discovered_without_engine_changes(tmp_path, monkeypatch):
    pkg = _make_package(
        tmp_path,
        monkeypatch,
        {
            "new_device": NEW_DEVICE_RULE,
            "_private_helpers": "VALUE = 1\n",  # modules starting with "_" are skipped
        },
    )
    found = discover_rules(pkg)
    assert set(found) == {"new_device"}
    assert found["new_device"].display_name == "New device"

    engine = RuleEngine({**discover_rules(app.rules), **found})
    assert set(engine.names) == SIX_RULES | {"new_device"}

    history = [Txn(transaction_id=f"H{i}", device_id="D-OLD", timestamp=datetime(2026, 9, 30, i)) for i in range(3)]
    results = engine.evaluate(Txn(), RuleContext(history, None), {})
    by_name = {r.rule_name: r for r in results}
    assert set(by_name) == SIX_RULES | {"new_device"}
    assert by_name["new_device"].triggered
    assert by_name["new_device"].score == 20  # default score without a config row
    assert by_name["new_device"].reason == "New device D-NEW (known: 1)"


def test_imported_rule_classes_are_not_double_counted(tmp_path, monkeypatch):
    pkg = _make_package(
        tmp_path,
        monkeypatch,
        {
            "new_device": NEW_DEVICE_RULE,
            "reexport": "from app.rules.velocity import VelocityRule  # noqa: F401\n",
        },
    )
    assert set(discover_rules(pkg)) == {"new_device"}


def test_broken_rule_module_is_skipped(tmp_path, monkeypatch):
    pkg = _make_package(
        tmp_path,
        monkeypatch,
        {"new_device": NEW_DEVICE_RULE, "broken": "raise RuntimeError('broken rule file')\n"},
    )
    assert set(discover_rules(pkg)) == {"new_device"}


def test_duplicate_rule_names_raise(tmp_path, monkeypatch):
    dup = '''
    from app.engine.base import FraudRule, RuleResult


    class {cls}(FraudRule):
        name = "dup_rule"
        display_name = "Duplicate"
        description = "Same name twice."
        default_score = 10
        default_params = {{}}

        def evaluate(self, txn, ctx, params):
            return RuleResult(self.name, False, "Passed: never")
    '''
    pkg = _make_package(
        tmp_path,
        monkeypatch,
        {"first": dup.format(cls="FirstRule"), "second": dup.format(cls="SecondRule")},
    )
    with pytest.raises(ValueError, match="dup_rule"):
        discover_rules(pkg)


# ---------------------------------------------------------------- engine


class AlwaysRule(FraudRule):
    name = "always"
    display_name = "Always"
    description = "Always fires."
    default_score = 15
    default_params = {"label": "x", "limit": 1}

    def evaluate(self, txn, ctx, params):
        return RuleResult(self.name, True, f"Fired with {params['label']}/{params['limit']}", dict(params))


class BoomRule(FraudRule):
    name = "boom"
    display_name = "Boom"
    description = "Always raises."
    default_score = 50
    default_params = {}

    def evaluate(self, txn, ctx, params):
        raise RuntimeError("kaboom")


class NeverRule(FraudRule):
    name = "never"
    display_name = "Never"
    description = "Never fires."
    default_score = 30
    default_params = {}

    def evaluate(self, txn, ctx, params):
        return RuleResult(self.name, False, "Passed: never fires")


def test_disabled_rule_is_not_run():
    engine = RuleEngine(discover_rules(app.rules))
    configs = {
        "high_risk_merchant": SimpleNamespace(enabled=False, score=20, params={}),
        "velocity": {"enabled": False, "score": 30, "params": {}},
    }
    results = engine.evaluate(Txn(), RuleContext([], None), configs)
    names = [r.rule_name for r in results]
    assert "high_risk_merchant" not in names
    assert "velocity" not in names
    assert set(names) == SIX_RULES - {"high_risk_merchant", "velocity"}
    assert names == sorted(names)


def test_enabled_watchlist_rule_runs_by_default():
    engine = RuleEngine(discover_rules(app.rules))
    results = {r.rule_name: r for r in engine.evaluate(Txn(), RuleContext([], None), {})}
    assert results["high_risk_merchant"].triggered
    assert results["high_risk_merchant"].score == 20
    assert results["shared_device"].reason == "Skipped: device graph not available"


def test_raising_rule_becomes_rule_error_and_others_still_run():
    engine = RuleEngine({"always": AlwaysRule, "boom": BoomRule, "never": NeverRule})
    results = engine.evaluate(Txn(), RuleContext([], None), {})
    assert [r.rule_name for r in results] == ["always", "boom", "never"]
    by_name = {r.rule_name: r for r in results}

    boom = by_name["boom"]
    assert boom.triggered is False
    assert boom.reason.startswith("Rule error")
    assert boom.reason == "Rule error: kaboom"
    assert boom.details == {"error": "kaboom"}
    assert boom.score == 0

    assert by_name["always"].triggered
    assert by_name["always"].score == 15
    assert by_name["never"].triggered is False
    assert by_name["never"].score == 0


def test_score_comes_from_config_and_params_merge_with_defaults():
    engine = RuleEngine({"always": AlwaysRule, "never": NeverRule})
    configs = {
        "always": SimpleNamespace(enabled=True, score=77, params={"limit": 9}),
        "never": {"enabled": True, "score": 99, "params": {}},
    }
    results = {r.rule_name: r for r in engine.evaluate(Txn(), RuleContext([], None), configs)}
    assert results["always"].score == 77
    assert results["always"].details == {"label": "x", "limit": 9}
    assert results["always"].reason == "Fired with x/9"
    assert results["never"].score == 0  # passed rules score 0 whatever the config says


def test_rules_are_instantiated_once():
    engine = RuleEngine({"always": AlwaysRule})
    first = engine.get("always")
    engine.evaluate(Txn(), RuleContext([], None), {})
    assert engine.get("always") is first
    assert isinstance(first, AlwaysRule)
