"""Admin data tools (ADMIN only): demo load, reset, simulator (plan Sections 14, 17)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_bus, get_db, get_engine
from app.enums import Role
from app.models import User
from app.schemas import SimulateIn
from app.security import require_roles

router = APIRouter(prefix="/api/admin", tags=["Admin"])

_admin = require_roles(Role.ADMIN)


@router.post("/demo/load")
def demo_load(
    db: Session = Depends(get_db),
    engine=Depends(get_engine),
    bus=Depends(get_bus),
    user: User = Depends(_admin),
) -> dict[str, Any]:
    from app.services.ingest import load_demo

    try:
        return load_demo(db, engine, bus, actor_id=user.id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=f"Demo dataset not found: {exc}") from None


@router.post("/reset")
def reset(
    db: Session = Depends(get_db),
    bus=Depends(get_bus),
    user: User = Depends(_admin),
) -> dict[str, Any]:
    from app.services.ingest import reset_data

    return reset_data(db, bus, actor_id=user.id)


@router.get("/scenarios")
def scenarios(_user: User = Depends(_admin)) -> list[dict[str, Any]]:
    from app.services.simulator import list_scenarios

    return list_scenarios()


@router.post("/simulate")
def simulate(
    body: SimulateIn,
    db: Session = Depends(get_db),
    engine=Depends(get_engine),
    bus=Depends(get_bus),
    user: User = Depends(_admin),
) -> dict[str, Any]:
    from app.services.simulator import run_scenario

    try:
        result = run_scenario(db, engine, bus, body.scenario, actor_id=user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if isinstance(result, dict) and "scenario" not in result:
        result = {"scenario": body.scenario, **result}
    return result
