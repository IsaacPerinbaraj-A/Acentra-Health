"""GET /api/events/recent - in-memory event feed (ADMIN)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_bus
from app.enums import Role
from app.models import User
from app.security import require_roles

router = APIRouter(prefix="/api/events", tags=["Events"])

MAX_LIMIT = 200


@router.get("/recent")
def recent_events(
    limit: int = Query(50, ge=1),
    bus=Depends(get_bus),
    _user: User = Depends(require_roles(Role.ADMIN)),
) -> list[dict]:
    return bus.recent(min(int(limit), MAX_LIMIT))
