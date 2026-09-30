"""Dashboard statistics (GET /api/stats, plan Section 14 / API contract).

    compute_stats(db, rules, date_from=None, date_to=None) -> dict

All counts are filtered on the *transaction* timestamp (``from`` / ``to``).
Also hosts ``parse_datetime_param`` used by routers for ``from`` / ``to`` query values.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.engine.engine import rule_meta
from app.enums import FlagStatus, NotificationStatus, RiskLevel
from app.models import FraudFlag, Notification, RuleResult, Transaction
from app.services.network import apply_time_range, build_network

__all__ = ["compute_stats", "parse_datetime_param", "FLAG_LEVELS"]

FLAG_LEVELS = (RiskLevel.MEDIUM.value, RiskLevel.HIGH.value, RiskLevel.CRITICAL.value)
_MAX_BUCKETS = 5000


def parse_datetime_param(value: str | None, *, end: bool = False) -> datetime | None:
    """Parse an ISO date or datetime query value into a naive UTC datetime.

    A date-only value used as an upper bound (``end=True``) means the end of that day.
    Raises ValueError on bad input (routers turn it into 422).
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    iso = text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        raise ValueError(
            f"Invalid date/time '{value}'; use ISO format, e.g. 2026-10-01 or 2026-10-01T09:00:00"
        ) from None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    if end and len(text) == 10:  # YYYY-MM-DD
        dt = dt + timedelta(days=1) - timedelta(microseconds=1)
    return dt


def _floor(dt: datetime, bucket: str) -> datetime:
    if bucket == "hour":
        return dt.replace(minute=0, second=0, microsecond=0)
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _flags_over_time(
    db: Session, date_from: datetime | None, date_to: datetime | None
) -> tuple[list[dict[str, Any]], str]:
    span_stmt = apply_time_range(
        select(func.min(Transaction.timestamp), func.max(Transaction.timestamp)), date_from, date_to
    )
    lo, hi = db.execute(span_stmt).one()
    if lo is None or hi is None:
        return [], "hour"
    bucket = "hour" if (hi - lo) <= timedelta(days=2) else "day"
    step = timedelta(hours=1) if bucket == "hour" else timedelta(days=1)

    counts: dict[datetime, dict[str, int]] = defaultdict(lambda: {lv: 0 for lv in FLAG_LEVELS})
    stmt = apply_time_range(
        select(Transaction.timestamp, FraudFlag.risk_level).join(
            Transaction, FraudFlag.transaction_pk == Transaction.id
        ),
        date_from,
        date_to,
    )
    for ts, level in db.execute(stmt).all():
        if ts is None or level not in FLAG_LEVELS:
            continue
        counts[_floor(ts, bucket)][level] += 1

    series: list[dict[str, Any]] = []
    cur, last = _floor(lo, bucket), _floor(hi, bucket)
    while cur <= last and len(series) < _MAX_BUCKETS:
        row = counts.get(cur) or {lv: 0 for lv in FLAG_LEVELS}
        series.append({"bucket": cur.isoformat(timespec="seconds"), **row})
        cur += step
    return series, bucket


def compute_stats(
    db: Session,
    rules: Mapping[str, Any] | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> dict[str, Any]:
    rules = rules or {}

    total_transactions = int(
        db.scalar(apply_time_range(select(func.count(Transaction.id)), date_from, date_to)) or 0
    )

    flags_by_level = {lv: 0 for lv in FLAG_LEVELS}
    flags_by_status = {s.value: 0 for s in FlagStatus}
    total_flags = 0
    flag_stmt = apply_time_range(
        select(FraudFlag.risk_level, FraudFlag.status, func.count(FraudFlag.id))
        .join(Transaction, FraudFlag.transaction_pk == Transaction.id)
        .group_by(FraudFlag.risk_level, FraudFlag.status),
        date_from,
        date_to,
    )
    for level, status, count in db.execute(flag_stmt).all():
        n = int(count or 0)
        total_flags += n
        if level in flags_by_level:
            flags_by_level[level] += n
        flags_by_status[status] = flags_by_status.get(status, 0) + n

    alerts_stmt = apply_time_range(
        select(func.count(Notification.id))
        .join(FraudFlag, Notification.flag_id == FraudFlag.id)
        .join(Transaction, FraudFlag.transaction_pk == Transaction.id)
        .where(
            Notification.flag_id.is_not(None),
            Notification.status.in_(
                [NotificationStatus.SENT.value, NotificationStatus.LOGGED.value]
            ),
        ),
        date_from,
        date_to,
    )
    alerts_sent = int(db.scalar(alerts_stmt) or 0)

    network = build_network(db, min_customers=2, date_from=date_from, date_to=date_to, limit=None)
    fraud_rings = sum(1 for c in network["clusters"] if c["is_ring"])

    fire_stmt = apply_time_range(
        select(RuleResult.rule_name, func.count(RuleResult.id))
        .join(Transaction, RuleResult.transaction_pk == Transaction.id)
        .where(RuleResult.triggered.is_(True))
        .group_by(RuleResult.rule_name),
        date_from,
        date_to,
    )
    fired = {name: int(count or 0) for name, count in db.execute(fire_stmt).all()}
    rule_fire_counts = []
    for name in sorted(set(rules) | set(fired)):
        cls = rules.get(name)
        display = (
            rule_meta(cls)["display_name"] if cls is not None else name.replace("_", " ").capitalize()
        )
        rule_fire_counts.append(
            {"rule_name": name, "display_name": display, "count": fired.get(name, 0)}
        )
    rule_fire_counts.sort(key=lambda r: (-r["count"], r["rule_name"]))

    flags_over_time, bucket = _flags_over_time(db, date_from, date_to)

    return {
        "total_transactions": total_transactions,
        "total_flags": total_flags,
        "pending_review": flags_by_status.get(FlagStatus.PENDING_REVIEW.value, 0),
        "alerts_sent": alerts_sent,
        "fraud_rings": fraud_rings,
        "flags_by_level": flags_by_level,
        "flags_by_status": flags_by_status,
        "rule_fire_counts": rule_fire_counts,
        "flags_over_time": flags_over_time,
        "bucket": bucket,
    }
