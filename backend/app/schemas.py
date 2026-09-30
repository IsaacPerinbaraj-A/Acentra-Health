"""Request bodies (Pydantic v2). Routers may return plain dicts shaped per docs/API_CONTRACT.md.

* ``TransactionIn``  - validated per plan Section 10 step 1; timestamp normalised per 6.1
                       (offset -> converted to UTC and made naive; naive kept as given).
                       Blank strings in optional fields become None (CSV empty cells),
                       currency defaults to "INR" and is upper-cased. Extra keys are ignored.
* ``LoginIn``, ``StatusChangeIn``, ``RulePatchIn``, ``BacktestIn``, ``SimulateIn``.
* ``normalize_timestamp(dt)`` - the 6.1 rule as a plain function.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.enums import FlagStatus

__all__ = [
    "normalize_timestamp",
    "TransactionIn",
    "LoginIn",
    "UserOut",
    "TokenOut",
    "StatusChangeIn",
    "RulePatchIn",
    "BacktestIn",
    "SimulateIn",
]


def normalize_timestamp(value: datetime) -> datetime:
    """Section 6.1: aware -> UTC with tzinfo dropped; naive -> unchanged."""
    if value.tzinfo is not None and value.utcoffset() is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.replace(tzinfo=None)


def _blank_to_none(value: Any) -> Any:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


class TransactionIn(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    transaction_id: str = Field(min_length=1, max_length=64)
    customer_id: str = Field(min_length=1, max_length=64)
    amount: float = Field(gt=0, allow_inf_nan=False)
    timestamp: datetime
    currency: str = Field(default="INR", pattern=r"^[A-Z]{3}$")
    merchant: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=80)
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    device_id: str | None = Field(default=None, max_length=64)
    account_balance: float | None = Field(default=None, ge=0, allow_inf_nan=False)

    @field_validator("transaction_id", "customer_id", mode="before")
    @classmethod
    def _id_to_str(cls, value: Any) -> Any:
        if isinstance(value, int) and not isinstance(value, bool):
            return str(value)
        return value

    @field_validator(
        "merchant", "city", "latitude", "longitude", "device_id", "account_balance", mode="before"
    )
    @classmethod
    def _optional_blank(cls, value: Any) -> Any:
        return _blank_to_none(value)

    @field_validator("currency", mode="before")
    @classmethod
    def _currency(cls, value: Any) -> Any:
        value = _blank_to_none(value)
        if value is None:
            return "INR"
        if isinstance(value, str):
            return value.upper()
        return value

    @field_validator("timestamp", mode="before")
    @classmethod
    def _timestamp_blank(cls, value: Any) -> Any:
        if isinstance(value, str):
            value = value.strip()
            if value.endswith(("Z", "z")):
                value = value[:-1] + "+00:00"
        return value

    @field_validator("timestamp", mode="after")
    @classmethod
    def _timestamp_normalize(cls, value: datetime) -> datetime:
        return normalize_timestamp(value)


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=256)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class StatusChangeIn(BaseModel):
    status: FlagStatus
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, value: Any) -> Any:
        return _blank_to_none(value)


class RulePatchIn(BaseModel):
    """PATCH /api/rules/{name}: any of enabled / score / params (params checked by the router
    with ``app.engine.validate_params`` -> 422)."""

    enabled: bool | None = None
    score: int | None = Field(default=None, ge=0, le=100)
    params: dict[str, Any] | None = None


class BacktestIn(BaseModel):
    """{overrides: {rule_name: {enabled?, score?, params?}}}"""

    overrides: dict[str, dict[str, Any]] = Field(default_factory=dict)


class SimulateIn(BaseModel):
    scenario: str = Field(min_length=1, max_length=64)
