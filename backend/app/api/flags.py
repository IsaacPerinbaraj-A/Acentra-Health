"""Flags router (plan Section 14 - Flags; docs/API_CONTRACT.md).

GET  /api/flags               any role   - filtered, sorted, paginated flag list
GET  /api/flags/{id}          any role   - FlagDetail
POST /api/flags/{id}/status   REVIEWER, ADMIN - change status (400 if unchanged) -> FlagDetail
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_bus, get_db, get_rules
from app.enums import FlagStatus, RiskLevel, Role
from app.models import User
from app.schemas import StatusChangeIn
from app.security import get_current_user, require_roles
from app.services import review

router = APIRouter(prefix="/api/flags", tags=["Flags"])


def _parse_dt(value: str | None, field: str) -> tuple[datetime | None, bool]:
    """Parse a `from`/`to` query value -> (naive datetime, date_only).

    Offsets are converted to UTC and dropped (plan 6.1). A bare date
    (YYYY-MM-DD) is reported as date_only so `to` can include the whole day.
    """
    if value is None or not str(value).strip():
        return None, False
    raw = str(value).strip()
    try:
        if len(raw) == 10:
            return datetime.fromisoformat(raw), True
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00").replace("z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid '{field}' datetime: {raw}") from None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt, False


@router.get("")
def list_flags(
    status: list[FlagStatus] | None = Query(None),
    level: list[RiskLevel] | None = Query(None),
    rule: str | None = Query(None),
    q: str | None = Query(None),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    sort: Literal["priority", "score", "newest", "oldest", "amount"] = Query("priority"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    rules: dict = Depends(get_rules),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    start, _ = _parse_dt(date_from, "from")
    end, end_date_only = _parse_dt(date_to, "to")
    if end is not None and end_date_only:
        end = end + timedelta(days=1)
    return review.list_flags(
        db,
        rules,
        statuses=[s.value for s in status] if status else None,
        levels=[lv.value for lv in level] if level else None,
        rule=rule or None,
        q=q,
        date_from=start,
        date_to=end,
        to_exclusive=end_date_only,
        sort=sort,
        page=page,
        page_size=page_size,
    )


def _load_flag(db: Session, flag_id: int):
    flag = review.get_flag(db, flag_id)
    if flag is None:
        raise HTTPException(status_code=404, detail=f"Flag {flag_id} not found")
    return flag


@router.get("/{flag_id}")
def get_flag(
    flag_id: int,
    db: Session = Depends(get_db),
    rules: dict = Depends(get_rules),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return review.build_flag_detail(db, _load_flag(db, flag_id), rules)


@router.post("/{flag_id}/status")
def change_flag_status(
    flag_id: int,
    body: StatusChangeIn,
    db: Session = Depends(get_db),
    bus=Depends(get_bus),
    rules: dict = Depends(get_rules),
    user: User = Depends(require_roles(Role.REVIEWER, Role.ADMIN)),
) -> dict[str, Any]:
    flag = _load_flag(db, flag_id)
    new_status = FlagStatus(body.status).value
    if new_status == str(flag.status):
        raise HTTPException(status_code=400, detail=f"Flag is already {new_status}")
    try:
        review.change_status(db, bus, flag, new_status, body.note, user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    db.expire_all()
    return review.build_flag_detail(db, _load_flag(db, flag_id), rules)
