"""GET /api/network - customer/device fraud network (plan Section 12). Any role."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models import User
from app.security import get_current_user
from app.services.network import build_network
from app.services.stats import parse_datetime_param

router = APIRouter(prefix="/api/network", tags=["Network"])


@router.get("")
def get_network(
    min_customers: int = Query(2, ge=1, le=1000),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict:
    try:
        start = parse_datetime_param(date_from)
        end = parse_datetime_param(date_to, end=True)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return build_network(db, min_customers=min_customers, date_from=start, date_to=end, limit=limit)
