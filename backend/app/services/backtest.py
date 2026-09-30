"""Rule backtesting and rule performance (plan Section 18).

``run_backtest(db, engine, overrides)`` re-evaluates every stored transaction
(max 5,000, oldest first) with the current rule configs plus ``overrides``
merged in, inside a SAVEPOINT that is always rolled back. Nothing is written,
nothing is committed and no events are published.

``rule_performance(db, rules)`` reports, per discovered rule, how reviewers
decided the flags on which that rule fired.
"""

from __future__ import annotations

import bisect
import copy
from collections import defaultdict
from collections.abc import Mapping
from types import SimpleNamespace
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.engine.base import RuleContext
from app.engine.engine import rule_meta, validate_params
from app.engine.scoring import risk_level, total_score
from app.enums import LEVEL_ORDER, FlagStatus, RiskLevel, level_gte
from app.models import FraudFlag, RuleConfig, RuleResult, Transaction

__all__ = ["MAX_BACKTEST_TRANSACTIONS", "build_configs", "run_backtest", "rule_performance"]

MAX_BACKTEST_TRANSACTIONS = 5000


# --------------------------------------------------------------------- configs


def build_configs(db: Session, engine, overrides: Mapping[str, Any] | None = None) -> dict[str, SimpleNamespace]:
    """Current rule_configs merged with `overrides`, as lightweight in-memory objects.

    Override shape: {rule_name: {"enabled"?: bool, "score"?: 0-100, "params"?: {...}}}.
    ``params`` are merged over the stored params (validated against the rule's
    defaults). Raises ValueError for unknown rules or invalid values.
    """
    overrides = dict(overrides or {})
    rule_names = list(getattr(engine, "names", None) or sorted(getattr(engine, "rules", {}) or {}))
    rows = {row.rule_name: row for row in db.scalars(select(RuleConfig))}

    configs: dict[str, SimpleNamespace] = {}
    for name in rule_names:
        rule = engine.get(name) if hasattr(engine, "get") else engine.rules[name]
        row = rows.get(name)
        if row is not None:
            configs[name] = SimpleNamespace(
                enabled=bool(row.enabled),
                score=int(row.score if row.score is not None else rule.default_score),
                params=copy.deepcopy(dict(row.params or {})),
            )
        else:
            configs[name] = SimpleNamespace(
                enabled=True,
                score=int(rule.default_score),
                params=copy.deepcopy(dict(rule.default_params or {})),
            )

    for name, override in overrides.items():
        if name not in configs:
            raise ValueError(f"Unknown rule '{name}'")
        if override is None:
            continue
        if hasattr(override, "model_dump"):
            override = override.model_dump(exclude_none=True)
        if not isinstance(override, Mapping):
            raise ValueError(f"Override for '{name}' must be an object")
        unknown = set(override) - {"enabled", "score", "params"}
        if unknown:
            raise ValueError(f"Unknown override field(s) for '{name}': {', '.join(sorted(unknown))}")
        config = configs[name]
        rule = engine.get(name) if hasattr(engine, "get") else engine.rules[name]
        if override.get("enabled") is not None:
            if not isinstance(override["enabled"], bool):
                raise ValueError(f"'enabled' for '{name}' must be true or false")
            config.enabled = override["enabled"]
        if override.get("score") is not None:
            score = override["score"]
            if isinstance(score, bool) or not isinstance(score, (int, float)) or int(score) != score:
                raise ValueError(f"'score' for '{name}' must be an integer")
            if not 0 <= int(score) <= 100:
                raise ValueError(f"'score' for '{name}' must be between 0 and 100")
            config.score = int(score)
        if override.get("params") is not None:
            clean = validate_params(dict(rule.default_params or {}), override["params"])
            config.params = {**config.params, **clean}
    return configs


# --------------------------------------------------------------------- backtest


def _empty_by_level(flag_min: RiskLevel) -> dict[str, int]:
    return {lv.value: 0 for lv in LEVEL_ORDER if level_gte(lv, flag_min)}


def run_backtest(db: Session, engine, overrides: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Compare stored flags with the flags the overridden configs would produce.

    Returns {current: {flagged, by_level}, simulated: {flagged, by_level},
    newly_flagged: [transaction_id], no_longer_flagged: [transaction_id]}.
    """
    settings = get_settings()
    flag_min = RiskLevel(settings.FLAG_MIN_LEVEL)
    history_limit = int(settings.HISTORY_LIMIT)

    configs = build_configs(db, engine, overrides)  # validates before touching anything

    nested = db.begin_nested()
    try:
        txns = list(
            db.scalars(
                select(Transaction)
                .order_by(Transaction.timestamp.asc(), Transaction.id.asc())
                .limit(MAX_BACKTEST_TRANSACTIONS)
            )
        )
        pks = [t.id for t in txns]
        stored_flags: dict[int, str] = {}
        if pks:
            for start in range(0, len(pks), 500):
                chunk = pks[start : start + 500]
                for pk, level in db.execute(
                    select(FraudFlag.transaction_pk, FraudFlag.risk_level).where(FraudFlag.transaction_pk.in_(chunk))
                ):
                    stored_flags[pk] = level

        # Per-customer ascending history (ties keep id order).
        by_customer: dict[str, list[Transaction]] = defaultdict(list)
        for t in txns:
            by_customer[t.customer_id].append(t)
        customer_times = {c: [t.timestamp for t in rows] for c, rows in by_customer.items()}

        current_by_level = _empty_by_level(flag_min)
        simulated_by_level = _empty_by_level(flag_min)
        newly_flagged: list[str] = []
        no_longer_flagged: list[str] = []
        current_count = 0
        simulated_count = 0

        for t in txns:
            rows = by_customer[t.customer_id]
            cut = bisect.bisect_left(customer_times[t.customer_id], t.timestamp)  # strictly earlier
            history = rows[max(0, cut - history_limit) : cut]
            results = engine.evaluate(t, RuleContext(history=history, session=db), configs)
            level = risk_level(total_score(results))
            simulated = level_gte(level, flag_min)

            stored = stored_flags.get(t.id)
            if stored is not None:
                current_count += 1
                key = RiskLevel(stored).value if stored in RiskLevel._value2member_map_ else str(stored)
                current_by_level[key] = current_by_level.get(key, 0) + 1
            if simulated:
                simulated_count += 1
                simulated_by_level[level.value] = simulated_by_level.get(level.value, 0) + 1

            if simulated and stored is None:
                newly_flagged.append(t.transaction_id)
            elif stored is not None and not simulated:
                no_longer_flagged.append(t.transaction_id)
    finally:
        if nested.is_active:
            nested.rollback()

    return {
        "current": {"flagged": current_count, "by_level": current_by_level},
        "simulated": {"flagged": simulated_count, "by_level": simulated_by_level},
        "newly_flagged": newly_flagged,
        "no_longer_flagged": no_longer_flagged,
    }


# --------------------------------------------------------------------- performance


def rule_performance(db: Session, rules) -> list[dict[str, Any]]:
    """Per discovered rule, reviewer outcomes of the flags on which it fired.

    [{rule_name, display_name, fired_on_flags, pending, reviewed, cleared,
      confirmed_fraud, clear_rate}] sorted by rule name; clear_rate =
    cleared / (cleared + confirmed_fraud), null when nothing was decided.
    """
    if hasattr(rules, "rules") and not isinstance(rules, Mapping):
        rules = rules.rules  # a RuleEngine
    rules = dict(rules or {})

    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    stmt = (
        select(RuleResult.rule_name, FraudFlag.status, func.count(func.distinct(FraudFlag.id)))
        .join(FraudFlag, FraudFlag.transaction_pk == RuleResult.transaction_pk)
        .where(RuleResult.triggered.is_(True))
        .group_by(RuleResult.rule_name, FraudFlag.status)
    )
    for rule_name, status, n in db.execute(stmt):
        counts[rule_name][str(status)] += int(n)

    out: list[dict[str, Any]] = []
    for name in sorted(rules):
        by_status = counts.get(name, {})
        pending = int(by_status.get(FlagStatus.PENDING_REVIEW.value, 0))
        reviewed = int(by_status.get(FlagStatus.REVIEWED.value, 0))
        cleared = int(by_status.get(FlagStatus.CLEARED.value, 0))
        confirmed = int(by_status.get(FlagStatus.CONFIRMED_FRAUD.value, 0))
        decided = cleared + confirmed
        out.append(
            {
                "rule_name": name,
                "display_name": rule_meta(rules[name])["display_name"],
                "fired_on_flags": int(sum(by_status.values())),
                "pending": pending,
                "reviewed": reviewed,
                "cleared": cleared,
                "confirmed_fraud": confirmed,
                "clear_rate": round(cleared / decided, 3) if decided else None,
            }
        )
    return out
