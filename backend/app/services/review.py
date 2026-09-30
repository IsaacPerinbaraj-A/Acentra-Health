"""Reviewer workflow: flag status changes plus the read models behind the
flags and customers routers (plan Sections 13, 14 - Flags, Customers).

Public API
----------
change_status(db, bus, flag, to_status, note, user) -> ReviewAction
serialize_transaction(txn) / serialize_result(row, rules) / serialize_notification(n)
flag_list_item(flag, rules, now=None) -> dict              (GET /api/flags items)
list_flags(db, rules, ...) -> Page dict                    (GET /api/flags)
build_flag_detail(db, flag, rules) -> FlagDetail dict      (GET/POST /api/flags/{id})
pending_queue(db) -> [(flag_id, sort_key)] in priority order
customer_profile(db, customer_id) -> dict | None           (GET /api/customers/{id})
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any

from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.database import utcnow
from app.enums import FlagStatus, RiskLevel
from app.events.events import FlagStatusChanged
from app.models import FraudFlag, Notification, ReviewAction, RuleResult, Transaction, User

__all__ = [
    "change_status",
    "serialize_transaction",
    "serialize_result",
    "serialize_notification",
    "flag_list_item",
    "list_flags",
    "build_flag_detail",
    "pending_queue",
    "customer_profile",
    "linked_customers",
    "SORTS",
]

SORTS = ("priority", "score", "newest", "oldest", "amount")
FLAG_LEVELS = (RiskLevel.MEDIUM.value, RiskLevel.HIGH.value, RiskLevel.CRITICAL.value)


# ---------------------------------------------------------------- helpers


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _status_value(value: Any) -> str:
    return FlagStatus(value).value


def _waiting_minutes(flag: FraudFlag, now: datetime | None = None) -> int | None:
    if str(flag.status) != FlagStatus.PENDING_REVIEW.value or flag.created_at is None:
        return None
    now = now or utcnow()
    return max(0, int((now - flag.created_at).total_seconds() // 60))


def _rule_meta(rules: dict | None, name: str) -> tuple[str, str]:
    cls = (rules or {}).get(name)
    if cls is None:
        return name, ""
    return getattr(cls, "display_name", name) or name, getattr(cls, "description", "") or ""


def _fired_sorted(results) -> list:
    fired = [r for r in results if r.triggered]
    return sorted(fired, key=lambda r: (-(r.score or 0), r.rule_name))


# ---------------------------------------------------------------- serializers


def serialize_transaction(txn: Transaction) -> dict[str, Any]:
    """TransactionOut."""
    return {
        "id": txn.id,
        "transaction_id": txn.transaction_id,
        "customer_id": txn.customer_id,
        "amount": txn.amount,
        "currency": txn.currency,
        "merchant": txn.merchant,
        "city": txn.city,
        "latitude": txn.latitude,
        "longitude": txn.longitude,
        "timestamp": _iso(txn.timestamp),
        "device_id": txn.device_id,
        "account_balance": txn.account_balance,
        "risk_score": txn.risk_score,
        "risk_level": str(txn.risk_level) if txn.risk_level is not None else None,
        "evaluated_at": _iso(txn.evaluated_at),
        "created_at": _iso(txn.created_at),
    }


def serialize_list_transaction(txn: Transaction) -> dict[str, Any]:
    """TransactionListItem = TransactionOut + {flag_id, flag_status, fired_rules}."""
    data = serialize_transaction(txn)
    flag = txn.flag
    data["flag_id"] = flag.id if flag is not None else None
    data["flag_status"] = str(flag.status) if flag is not None else None
    data["fired_rules"] = [r.rule_name for r in _fired_sorted(txn.rule_results)]
    return data


def serialize_result(row: Any, rules: dict | None = None) -> dict[str, Any]:
    """RuleResultOut from a RuleResult row (or any object with the same attributes)."""
    name = row.rule_name
    display_name, description = _rule_meta(rules, name)
    return {
        "rule_name": name,
        "display_name": display_name,
        "description": description,
        "triggered": bool(row.triggered),
        "score": int(row.score or 0),
        "reason": row.reason,
        "details": row.details or {},
    }


def serialize_notification(n: Notification | None) -> dict[str, Any] | None:
    """NotificationOut (prefers the notifier service's serializer when available)."""
    if n is None:
        return None
    try:
        from app.services.notifier import serialize_notification as _ser  # lazy: other agent's module

        return _ser(n)
    except ImportError:
        pass
    return {
        "id": n.id,
        "flag_id": n.flag_id,
        "transaction_id": n.transaction_id,
        "channel": n.channel,
        "target": n.target,
        "status": str(n.status),
        "subject": n.subject,
        "message": n.message,
        "error": n.error,
        "created_at": _iso(n.created_at),
    }


def _serialize_flag(flag: FraudFlag, now: datetime | None = None) -> dict[str, Any]:
    reviewer = flag.reviewer
    return {
        "id": flag.id,
        "status": str(flag.status),
        "risk_score": flag.risk_score,
        "risk_level": str(flag.risk_level),
        "created_at": _iso(flag.created_at),
        "updated_at": _iso(flag.updated_at),
        "last_reviewed_by": flag.last_reviewed_by,
        "last_reviewed_by_username": reviewer.username if reviewer is not None else None,
        "last_reviewed_at": _iso(flag.last_reviewed_at),
        "waiting_minutes": _waiting_minutes(flag, now),
    }


def flag_list_item(flag: FraudFlag, rules: dict | None, now: datetime | None = None) -> dict[str, Any]:
    txn = flag.transaction
    fired = _fired_sorted(txn.rule_results)
    return {
        "id": flag.id,
        "status": str(flag.status),
        "risk_score": flag.risk_score,
        "risk_level": str(flag.risk_level),
        "created_at": _iso(flag.created_at),
        "updated_at": _iso(flag.updated_at),
        "waiting_minutes": _waiting_minutes(flag, now),
        "transaction": {
            "transaction_id": txn.transaction_id,
            "customer_id": txn.customer_id,
            "amount": txn.amount,
            "currency": txn.currency,
            "merchant": txn.merchant,
            "city": txn.city,
            "timestamp": _iso(txn.timestamp),
        },
        "fired_rules": [_rule_meta(rules, r.rule_name)[0] for r in fired],
        "fired_rule_names": [r.rule_name for r in fired],
    }


# ---------------------------------------------------------------- flags list


def _priority_order():
    pending_first = case((FraudFlag.status == FlagStatus.PENDING_REVIEW.value, 0), else_=1)
    return [pending_first, FraudFlag.risk_score.desc(), Transaction.timestamp.desc(), FraudFlag.id.desc()]


def _sort_clause(sort: str):
    if sort == "score":
        return [FraudFlag.risk_score.desc(), Transaction.timestamp.desc(), FraudFlag.id.desc()]
    if sort == "newest":
        return [Transaction.timestamp.desc(), FraudFlag.id.desc()]
    if sort == "oldest":
        return [Transaction.timestamp.asc(), FraudFlag.id.asc()]
    if sort == "amount":
        return [Transaction.amount.desc(), FraudFlag.risk_score.desc(), FraudFlag.id.desc()]
    return _priority_order()


def list_flags(
    db: Session,
    rules: dict | None,
    *,
    statuses: list[str] | None = None,
    levels: list[str] | None = None,
    rule: str | None = None,
    q: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    to_exclusive: bool = False,
    sort: str = "priority",
    page: int = 1,
    page_size: int = 25,
) -> dict[str, Any]:
    conditions = []
    if statuses:
        conditions.append(FraudFlag.status.in_([_status_value(s) for s in statuses]))
    if levels:
        conditions.append(FraudFlag.risk_level.in_([RiskLevel(lv).value for lv in levels]))
    if rule:
        conditions.append(
            exists().where(
                RuleResult.transaction_pk == Transaction.id,
                RuleResult.rule_name == rule,
                RuleResult.triggered.is_(True),
            )
        )
    if q and q.strip():
        pattern = f"%{q.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(Transaction.transaction_id).like(pattern),
                func.lower(Transaction.customer_id).like(pattern),
                func.lower(func.coalesce(Transaction.merchant, "")).like(pattern),
            )
        )
    if date_from is not None:
        conditions.append(Transaction.timestamp >= date_from)
    if date_to is not None:
        conditions.append(Transaction.timestamp < date_to if to_exclusive else Transaction.timestamp <= date_to)

    base = select(FraudFlag).join(Transaction, FraudFlag.transaction_pk == Transaction.id)
    if conditions:
        base = base.where(and_(*conditions))

    total = db.scalar(select(func.count()).select_from(base.order_by(None).subquery())) or 0
    stmt = (
        base.options(
            selectinload(FraudFlag.transaction).selectinload(Transaction.rule_results),
        )
        .order_by(*_sort_clause(sort))
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    flags = db.scalars(stmt).all()
    now = utcnow()
    return {
        "items": [flag_list_item(f, rules, now) for f in flags],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


# ---------------------------------------------------------------- pending queue


def _queue_key(score: int, ts: datetime | None, flag_id: int) -> tuple:
    return (-(score or 0), -(ts.timestamp() if ts is not None else 0.0), -flag_id)


def pending_queue(db: Session) -> list[tuple[int, tuple]]:
    """[(flag_id, sort_key)] for the default pending queue, in priority order."""
    rows = db.execute(
        select(FraudFlag.id, FraudFlag.risk_score, Transaction.timestamp)
        .join(Transaction, FraudFlag.transaction_pk == Transaction.id)
        .where(FraudFlag.status == FlagStatus.PENDING_REVIEW.value)
        .order_by(FraudFlag.risk_score.desc(), Transaction.timestamp.desc(), FraudFlag.id.desc())
    ).all()
    return [(fid, _queue_key(score, ts, fid)) for fid, score, ts in rows]


def _queue_navigation(db: Session, flag: FraudFlag) -> dict[str, Any]:
    queue = pending_queue(db)
    ids = [fid for fid, _ in queue]
    total = len(ids)
    if flag.id in ids:
        idx = ids.index(flag.id)
        return {
            "prev_id": ids[idx - 1] if idx > 0 else None,
            "next_id": ids[idx + 1] if idx + 1 < total else None,
            "queue_position": idx + 1,
            "queue_total": total,
        }
    # Not pending (e.g. just reviewed): neighbours are where it would sit in the queue,
    # so "next" after a decision is the flag that followed it.
    key = _queue_key(flag.risk_score, flag.transaction.timestamp if flag.transaction else None, flag.id)
    prev_id = None
    next_id = None
    for fid, k in queue:
        if k < key:
            prev_id = fid
        elif k > key:
            next_id = fid
            break
    return {"prev_id": prev_id, "next_id": next_id, "queue_position": None, "queue_total": total}


# ---------------------------------------------------------------- customers


def linked_customers(db: Session, customer_id: str) -> list[dict[str, Any]]:
    """[{customer_id, via_device_ids}] - uses services.network when available."""
    try:
        from app.services.network import linked_customers as _linked  # lazy: other agent's module

        return _linked(db, customer_id)
    except ImportError:
        pass
    devices = select(Transaction.device_id).where(
        Transaction.customer_id == customer_id, Transaction.device_id.is_not(None)
    )
    rows = db.execute(
        select(Transaction.customer_id, Transaction.device_id)
        .where(Transaction.device_id.in_(devices), Transaction.customer_id != customer_id)
        .distinct()
    ).all()
    linked: dict[str, set[str]] = {}
    for cid, did in rows:
        linked.setdefault(cid, set()).add(did)
    return [{"customer_id": cid, "via_device_ids": sorted(dids)} for cid, dids in sorted(linked.items())]


def _customer_stats(txns: list[Transaction]) -> dict[str, Any]:
    count = len(txns)
    total = round(sum(t.amount or 0 for t in txns), 2)
    cities = Counter(t.city for t in txns if t.city)
    city_list = [{"city": c, "count": n} for c, n in sorted(cities.items(), key=lambda kv: (-kv[1], kv[0]))]
    return {
        "transaction_count": count,
        "total_amount": total,
        "average_amount": round(total / count, 2) if count else 0,
        "usual_city": city_list[0]["city"] if city_list else None,
        "cities": city_list,
    }


def customer_profile(db: Session, customer_id: str) -> dict[str, Any] | None:
    txns = db.scalars(
        select(Transaction)
        .where(Transaction.customer_id == customer_id)
        .options(selectinload(Transaction.rule_results), selectinload(Transaction.flag))
        .order_by(Transaction.timestamp.desc(), Transaction.id.desc())
    ).all()
    if not txns:
        return None
    stats = _customer_stats(list(txns))

    device_counts = Counter(t.device_id for t in txns if t.device_id)
    customer_counts: dict[str, int] = {}
    if device_counts:
        customer_counts = dict(
            db.execute(
                select(Transaction.device_id, func.count(func.distinct(Transaction.customer_id)))
                .where(Transaction.device_id.in_(list(device_counts)))
                .group_by(Transaction.device_id)
            ).all()
        )
    devices = [
        {"device_id": d, "count": n, "customer_count": int(customer_counts.get(d, 1))}
        for d, n in sorted(device_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    flags_by_status = {s.value: 0 for s in FlagStatus}
    flags_by_level = {lv: 0 for lv in FLAG_LEVELS}
    for t in txns:
        if t.flag is not None:
            st = str(t.flag.status)
            lv = str(t.flag.risk_level)
            flags_by_status[st] = flags_by_status.get(st, 0) + 1
            flags_by_level[lv] = flags_by_level.get(lv, 0) + 1

    latest_balance = next((t.account_balance for t in txns if t.account_balance is not None), None)
    return {
        "customer_id": customer_id,
        "transaction_count": stats["transaction_count"],
        "total_amount": stats["total_amount"],
        "average_amount": stats["average_amount"],
        "first_seen": _iso(min(t.timestamp for t in txns)),
        "last_seen": _iso(max(t.timestamp for t in txns)),
        "latest_balance": latest_balance,
        "cities": stats["cities"],
        "devices": devices,
        "linked_customers": linked_customers(db, customer_id),
        "flags_by_status": flags_by_status,
        "flags_by_level": flags_by_level,
        "transactions": [serialize_list_transaction(t) for t in txns[:100]],
    }


# ---------------------------------------------------------------- flag detail


def build_flag_detail(db: Session, flag: FraudFlag, rules: dict | None) -> dict[str, Any]:
    txn = flag.transaction
    results = list(txn.rule_results)
    fired = _fired_sorted(results)
    passed = sorted((r for r in results if not r.triggered), key=lambda r: r.rule_name)

    customer_txns = db.scalars(select(Transaction).where(Transaction.customer_id == txn.customer_id)).all()
    summary = _customer_stats(list(customer_txns))
    summary = {"customer_id": txn.customer_id, **summary, "linked_customers": linked_customers(db, txn.customer_id)}

    history = db.scalars(
        select(Transaction)
        .where(
            Transaction.customer_id == txn.customer_id,
            Transaction.id != txn.id,
            or_(
                Transaction.timestamp < txn.timestamp,
                and_(Transaction.timestamp == txn.timestamp, Transaction.id < txn.id),
            ),
        )
        .options(selectinload(Transaction.flag))
        .order_by(Transaction.timestamp.desc(), Transaction.id.desc())
        .limit(10)
    ).all()
    recent_history = []
    for h in history:
        item = serialize_transaction(h)
        item["flag_id"] = h.flag.id if h.flag is not None else None
        recent_history.append(item)

    actions = sorted(
        flag.review_actions,
        key=lambda a: (a.created_at or datetime.min, a.id or 0),
        reverse=True,
    )
    review_actions = [
        {
            "id": a.id,
            "from_status": str(a.from_status),
            "to_status": str(a.to_status),
            "note": a.note,
            "created_at": _iso(a.created_at),
            "user_id": a.user_id,
            "username": a.user.username if a.user is not None else None,
        }
        for a in actions
    ]

    detail: dict[str, Any] = {
        "flag": _serialize_flag(flag),
        "transaction": serialize_transaction(txn),
        "score": txn.risk_score,
        "raw_score": sum(int(r.score or 0) for r in fired),
        "level": str(txn.risk_level),
        "results": [serialize_result(r, rules) for r in fired + passed],
        "customer_summary": summary,
        "recent_history": recent_history,
        "review_actions": review_actions,
        "notification": serialize_notification(flag.notification),
    }
    detail.update(_queue_navigation(db, flag))
    return detail


def get_flag(db: Session, flag_id: int) -> FraudFlag | None:
    return db.scalars(
        select(FraudFlag)
        .where(FraudFlag.id == flag_id)
        .options(
            selectinload(FraudFlag.transaction).selectinload(Transaction.rule_results),
            selectinload(FraudFlag.review_actions).selectinload(ReviewAction.user),
            selectinload(FraudFlag.notification),
            selectinload(FraudFlag.reviewer),
        )
    ).one_or_none()


# ---------------------------------------------------------------- status change


def change_status(
    db: Session,
    bus: Any,
    flag: FraudFlag,
    to_status: Any,
    note: str | None,
    user: User,
) -> ReviewAction:
    """Record a review decision and publish FlagStatusChanged.

    Raises ValueError if `to_status` equals the current status (router -> 400).
    """
    new_status = _status_value(to_status)
    old_status = str(flag.status)
    if new_status == old_status:
        raise ValueError(f"Flag is already {new_status}")
    note = note.strip() if isinstance(note, str) else None
    note = note or None

    now = utcnow()
    action = ReviewAction(
        flag_id=flag.id,
        user_id=user.id,
        from_status=old_status,
        to_status=new_status,
        note=note,
        created_at=now,
    )
    db.add(action)
    flag.status = new_status
    flag.last_reviewed_by = user.id
    flag.last_reviewed_at = now
    flag.updated_at = now
    db.commit()
    db.refresh(action)

    transaction_id = flag.transaction.transaction_id if flag.transaction is not None else ""
    if bus is not None:
        bus.publish(
            FlagStatusChanged(
                flag_id=flag.id,
                transaction_id=transaction_id,
                from_status=old_status,
                to_status=new_status,
                note=note,
                user_id=user.id,
            ),
            db,
        )
    return action
