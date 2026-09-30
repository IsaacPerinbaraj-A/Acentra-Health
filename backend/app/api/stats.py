"""GET /api/stats - dashboard numbers (any role)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_rules
from app.models import User
from app.security import get_current_user
from app.services.stats import compute_stats, parse_datetime_param

router = APIRouter(prefix="/api/stats", tags=["Stats"])


@router.get("")
def get_stats(
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    db: Session = Depends(get_db),
    rules: dict = Depends(get_rules),
    _user: User = Depends(get_current_user),
) -> dict:
    try:
        start = parse_datetime_param(date_from)
        end = parse_datetime_param(date_to, end=True)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return compute_stats(db, rules, date_from=start, date_to=end)
