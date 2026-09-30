"""Notifications API (plan Section 14, docs/API_CONTRACT.md). ADMIN only."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_bus, get_db
from app.enums import Role
from app.events.events import TestAlertSent
from app.models import Notification, User
from app.security import require_roles
from app.services.notifier import send_test_alert, serialize_notification

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


@router.get("")
def list_notifications(
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    _user: User = Depends(require_roles(Role.ADMIN)),
) -> dict[str, Any]:
    stmt = select(Notification)
    if status and status.strip():
        stmt = stmt.where(Notification.status == status.strip().upper())
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return {
        "items": [serialize_notification(n) for n in rows],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


@router.post("/test")
def send_test(
    db: Session = Depends(get_db),
    bus=Depends(get_bus),
    user: User = Depends(require_roles(Role.ADMIN)),
) -> dict[str, Any]:
    notification = send_test_alert(db, user_id=user.id)
    out = serialize_notification(notification)
    if bus is not None:
        bus.publish(
            TestAlertSent(
                channel=str(notification.channel), status=str(notification.status), user_id=user.id
            ),
            db,
        )
    return out
