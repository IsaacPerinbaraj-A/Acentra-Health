"""Authentication and RBAC (plan Section 13).

Dependencies for routers::

    from app.security import get_current_user, require_roles, require_ingest_actor
    from app.enums import Role

    @router.get("/me")
    def me(user: User = Depends(get_current_user)): ...

    @router.post("/{flag_id}/status")
    def change(..., user: User = Depends(require_roles(Role.REVIEWER, Role.ADMIN))): ...

    @router.post("")
    def ingest(..., actor: User | None = Depends(require_ingest_actor)): ...
        # actor is None for the X-API-Key (system) caller, else the ADMIN user

Status codes: 401 (missing / invalid / expired token, unknown user, wrong API key;
always with ``WWW-Authenticate: Bearer``), 403 (authenticated, wrong role).
"""

from __future__ import annotations

import hmac
from datetime import timedelta
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import get_db, utcnow
from app.enums import Role
from app.models import User

__all__ = [
    "JWT_ALGORITHM",
    "hash_password",
    "verify_password",
    "create_access_token",
    "decode_access_token",
    "authenticate_user",
    "get_current_user",
    "get_optional_user",
    "require_roles",
    "require_admin",
    "require_reviewer",
    "require_ingest_actor",
    "bearer_scheme",
    "api_key_scheme",
]

JWT_ALGORITHM = "HS256"

bearer_scheme = HTTPBearer(auto_error=False, description="JWT from POST /api/auth/login")
api_key_scheme = APIKeyHeader(
    name="X-API-Key", auto_error=False, description="INGEST_API_KEY (upstream payment system)"
)


# ---------------------------------------------------------------- passwords


def hash_password(password: str, rounds: int = 12) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=rounds)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    """The user if the credentials are valid, else None."""
    user = db.query(User).filter(User.username == username).one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        return None
    return user


# ---------------------------------------------------------------- tokens


def create_access_token(user: User, settings: Settings | None = None) -> str:
    """HS256 JWT: {"sub": str(user.id), "username", "role", "exp"}."""
    settings = settings or get_settings()
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": str(user.role),
        "exp": utcnow() + timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
    }
    # PyJWT treats naive datetimes as UTC.
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str, settings: Settings | None = None) -> dict[str, Any]:
    """Decoded payload; raises jwt.PyJWTError when invalid or expired."""
    settings = settings or get_settings()
    return jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[JWT_ALGORITHM],
        options={"require": ["exp", "sub"]},
    )


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _user_from_token(token: str, db: Session, settings: Settings) -> User:
    try:
        payload = decode_access_token(token, settings)
        user_id = int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Token expired") from None
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise _unauthorized("Invalid token") from None
    user = db.get(User, user_id)
    if user is None:
        raise _unauthorized("User not found")
    return user


# ---------------------------------------------------------------- dependencies


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    """The user of the ``Authorization: Bearer <token>`` header, or 401."""
    if credentials is None or not credentials.credentials:
        raise _unauthorized("Not authenticated")
    return _user_from_token(credentials.credentials, db, settings)


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User | None:
    """Like get_current_user but returns None when no token is sent."""
    if credentials is None or not credentials.credentials:
        return None
    return _user_from_token(credentials.credentials, db, settings)


def require_roles(*roles: Role | str):
    """Dependency factory: the current user if their role is in `roles`, else 403."""
    allowed = {Role(r).value for r in roles}

    def dependency(user: User = Depends(get_current_user)) -> User:
        if str(user.role) not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to perform this action",
            )
        return user

    dependency.__name__ = "require_" + "_or_".join(sorted(allowed)).lower()
    return dependency


require_admin = require_roles(Role.ADMIN)
require_reviewer = require_roles(Role.REVIEWER, Role.ADMIN)


def require_ingest_actor(
    api_key: str | None = Depends(api_key_scheme),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User | None:
    """Ingestion auth: valid ``X-API-Key`` -> None (system actor); ADMIN bearer -> that user.

    Wrong API key or no credentials -> 401; a valid non-admin token -> 403.
    """
    if api_key is not None:
        expected = settings.INGEST_API_KEY or ""
        if expected and hmac.compare_digest(api_key.encode("utf-8"), expected.encode("utf-8")):
            return None
        raise _unauthorized("Invalid API key")
    if credentials is None or not credentials.credentials:
        raise _unauthorized("Not authenticated: send X-API-Key or an admin bearer token")
    user = _user_from_token(credentials.credentials, db, settings)
    if str(user.role) != Role.ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins (or the ingest API key) can submit transactions",
        )
    return user
