"""Transactions API (plan Section 14, docs/API_CONTRACT.md)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_bus, get_db, get_engine, get_rules
from app.enums import Role
from app.models import FraudFlag, Transaction, User
from app.models import RuleResult as RuleResultRow
from app.schemas import TransactionIn
from app.security import get_current_user, require_ingest_actor, require_roles
from app.services.ingest import (
    MAX_BULK_ROWS,
    MAX_UPLOAD_BYTES,
    DuplicateTransaction,
    format_error,
    import_csv,
    ingest_batch,
    ingest_transaction,
    serialize_result,
    serialize_transaction,
    sort_results,
)

router = APIRouter(prefix="/api/transactions", tags=["Transactions"])


def _naive(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


@router.post("", status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: TransactionIn,
    db: Session = Depends(get_db),
    engine=Depends(get_engine),
    bus=Depends(get_bus),
    rules=Depends(get_rules),
    actor: User | None = Depends(require_ingest_actor),
) -> dict[str, Any]:
    try:
        result = ingest_transaction(
            db, engine, bus, payload, "api", actor_id=actor.id if actor is not None else None
        )
    except DuplicateTransaction as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except (ValidationError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=format_error(exc)
        ) from exc
    return {
        "transaction": serialize_transaction(result.transaction),
        "score": result.score,
        "raw_score": result.raw_score,
        "level": result.level,
        "results": [serialize_result(r, rules) for r in sort_results(result.results)],
        "flag_id": result.flag_id,
        "notification_status": result.notification_status,
    }


@router.post("/bulk")
def bulk_ingest(
    payloads: list[dict[str, Any]] = Body(...),
    db: Session = Depends(get_db),
    engine=Depends(get_engine),
    bus=Depends(get_bus),
    actor: User | None = Depends(require_ingest_actor),
) -> dict[str, Any]:
    """Rows are validated one by one so a bad row is reported, not fatal."""
    if len(payloads) > MAX_BULK_ROWS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"At most {MAX_BULK_ROWS} transactions per request",
        )
    return ingest_batch(
        db, engine, bus, payloads, "api", actor_id=actor.id if actor is not None else None
    )


@router.post("/upload")
def upload_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    engine=Depends(get_engine),
    bus=Depends(get_bus),
    user: User = Depends(require_roles(Role.ADMIN)),
) -> dict[str, Any]:
    content = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large (max 5 MB)",
        )
    try:
        return import_csv(db, engine, bus, content, actor_id=user.id, filename=file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("")
def list_transactions(
    q: str | None = Query(None),
    level: list[str] | None = Query(None),
    customer_id: str | None = Query(None),
    device_id: str | None = Query(None),
    date_from: datetime | None = Query(None, alias="from"),
    date_to: datetime | None = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    stmt = select(Transaction)
    if q and q.strip():
        pattern = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Transaction.transaction_id).like(pattern),
                func.lower(Transaction.customer_id).like(pattern),
            )
        )
    levels = [lv.strip().upper() for lv in (level or []) if lv and lv.strip()]
    if levels:
        stmt = stmt.where(Transaction.risk_level.in_(levels))
    if customer_id:
        stmt = stmt.where(Transaction.customer_id == customer_id)
    if device_id:
        stmt = stmt.where(Transaction.device_id == device_id)
    if date_from is not None:
        stmt = stmt.where(Transaction.timestamp >= _naive(date_from))
    if date_to is not None:
        stmt = stmt.where(Transaction.timestamp <= _naive(date_to))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    txns = list(
        db.scalars(
            stmt.order_by(Transaction.timestamp.desc(), Transaction.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    pks = [t.id for t in txns]
    flags: dict[int, FraudFlag] = {}
    fired: dict[int, list[str]] = {pk: [] for pk in pks}
    if pks:
        for flag in db.scalars(select(FraudFlag).where(FraudFlag.transaction_pk.in_(pks))):
            flags[flag.transaction_pk] = flag
        for pk, name in db.execute(
            select(RuleResultRow.transaction_pk, RuleResultRow.rule_name)
            .where(RuleResultRow.transaction_pk.in_(pks), RuleResultRow.triggered.is_(True))
            .order_by(RuleResultRow.score.desc(), RuleResultRow.rule_name)
        ):
            fired[pk].append(name)

    items = []
    for t in txns:
        flag = flags.get(t.id)
        item = serialize_transaction(t)
        item["flag_id"] = flag.id if flag is not None else None
        item["flag_status"] = str(flag.status) if flag is not None else None
        item["fired_rules"] = fired.get(t.id, [])
        items.append(item)
    return {"items": items, "total": int(total), "page": page, "page_size": page_size}


@router.get("/{transaction_id}")
def get_transaction(
    transaction_id: str,
    db: Session = Depends(get_db),
    rules=Depends(get_rules),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    txn = db.scalar(select(Transaction).where(Transaction.transaction_id == transaction_id))
    if txn is None:
        raise HTTPException(status_code=404, detail=f"Transaction {transaction_id} not found")
    rows = list(db.scalars(select(RuleResultRow).where(RuleResultRow.transaction_pk == txn.id)))
    flag = db.scalar(select(FraudFlag).where(FraudFlag.transaction_pk == txn.id))
    return {
        "transaction": serialize_transaction(txn),
        "results": [serialize_result(r, rules) for r in sort_results(rows)],
        "flag_id": flag.id if flag is not None else None,
        "flag_status": str(flag.status) if flag is not None else None,
    }
