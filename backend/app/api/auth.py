"""Auth router: POST /api/auth/login, GET /api/auth/me (plan Sections 13, 14)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_bus, get_db, get_settings
from app.config import Settings
from app.events.events import UserLoggedIn
from app.models import User
from app.schemas import LoginIn
from app.security import authenticate_user, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["Auth"])


def _user_out(user: User) -> dict[str, Any]:
    return {"id": user.id, "username": user.username, "role": str(user.role)}


@router.post("/login")
def login(
    body: LoginIn,
    db: Session = Depends(get_db),
    bus=Depends(get_bus),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    user = authenticate_user(db, body.username, body.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(user, settings)
    out = _user_out(user)
    if bus is not None:
        bus.publish(UserLoggedIn(user_id=user.id, username=user.username), db)
    return {"access_token": token, "token_type": "bearer", "user": out}


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> dict[str, Any]:
    return _user_out(user)
