"""GET /api/audit - paginated audit log, newest first (ADMIN)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.enums import Role
from app.models import AuditLog, User
from app.security import require_roles

router = APIRouter(prefix="/api/audit", tags=["Audit"])


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") if value is not None else None


def serialize_audit(row: AuditLog) -> dict[str, Any]:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "username": row.username,
        "action": row.action,
        "entity_type": row.entity_type,
        "entity_id": row.entity_id,
        "details": row.details or {},
        "created_at": _iso(row.created_at),
    }


@router.get("")
def list_audit(
    action: str | None = Query(None),
    username: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles(Role.ADMIN)),
) -> dict[str, Any]:
    stmt = select(AuditLog).outerjoin(User, AuditLog.user_id == User.id)
    if action and action.strip():
        stmt = stmt.where(AuditLog.action == action.strip())
    if username and username.strip():
        stmt = stmt.where(func.lower(User.username) == username.strip().lower())

    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(
        stmt.options(selectinload(AuditLog.user))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [serialize_audit(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
