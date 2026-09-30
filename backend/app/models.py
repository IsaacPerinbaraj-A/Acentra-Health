"""ORM models - every table of plan Section 6.

Conventions
-----------
* All datetimes are naive UTC (``utcnow()``); transaction timestamps are stored
  exactly as normalised by ``schemas.normalize_timestamp`` (Section 6.1).
* Enum-valued columns (role, risk_level, status, ...) are plain strings holding
  the enum value ("HIGH", "PENDING_REVIEW", ...). StrEnum members can be
  assigned directly and compare equal to the stored strings.
* Deleting a Transaction cascades (ORM and ``ON DELETE CASCADE`` in SQLite) to its
  rule_results and fraud_flag, and from the flag to its review_actions and
  notification. So ``db.execute(delete(Transaction))`` plus
  ``db.execute(delete(Notification))`` (test alerts have no flag) empties the data.

Convenience relationships / properties
--------------------------------------
Transaction.rule_results (ordered by rule_name), Transaction.flag (one or None),
Transaction.flag_id / flag_status / fired_rules (read-only helpers),
FraudFlag.transaction, FraudFlag.review_actions (oldest first - sort newest first
in the API), FraudFlag.notification, FraudFlag.reviewer, ReviewAction.user /
.flag / .username, Notification.flag / .transaction_id, RuleConfig.updater,
AuditLog.user / .username.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow
from app.enums import FlagStatus, RiskLevel

__all__ = [
    "Base",
    "utcnow",
    "User",
    "Transaction",
    "RuleResult",
    "FraudFlag",
    "ReviewAction",
    "Notification",
    "RuleConfig",
    "AuditLog",
    "RuleResultRow",
]


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    def __repr__(self) -> str:
        return f"<User {self.id} {self.username} {self.role}>"


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_transactions_customer_id_timestamp", "customer_id", "timestamp"),
        Index("ix_transactions_device_id_timestamp", "device_id", "timestamp"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transaction_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    customer_id: Mapped[str] = mapped_column(String(64), index=True)
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    merchant: Mapped[str | None] = mapped_column(String(120), nullable=True)
    city: Mapped[str | None] = mapped_column(String(80), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)
    device_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    account_balance: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    risk_level: Mapped[str] = mapped_column(String(16), default=RiskLevel.LOW.value)
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    rule_results: Mapped[list[RuleResult]] = relationship(
        back_populates="transaction",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="RuleResult.rule_name",
    )
    flag: Mapped[FraudFlag | None] = relationship(
        back_populates="transaction",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    # ---- read-only helpers used by schemas.TransactionOut (from_attributes) ----
    @property
    def flag_id(self) -> int | None:
        return self.flag.id if self.flag is not None else None

    @property
    def flag_status(self) -> str | None:
        return self.flag.status if self.flag is not None else None

    @property
    def fired_rules(self) -> list[str]:
        """Names (snake_case) of the rules that fired, alphabetical."""
        return [r.rule_name for r in self.rule_results if r.triggered]

    def __repr__(self) -> str:
        return f"<Transaction {self.transaction_id} {self.customer_id} {self.amount}>"


class RuleResult(Base):
    __tablename__ = "rule_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transaction_pk: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), index=True
    )
    rule_name: Mapped[str] = mapped_column(String(64), index=True)
    triggered: Mapped[bool] = mapped_column(Boolean, default=False)
    score: Mapped[int] = mapped_column(Integer, default=0)
    reason: Mapped[str] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    transaction: Mapped[Transaction] = relationship(back_populates="rule_results")

    def __repr__(self) -> str:
        return f"<RuleResult {self.rule_name} triggered={self.triggered} score={self.score}>"


class FraudFlag(Base):
    __tablename__ = "fraud_flags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transaction_pk: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), unique=True, index=True
    )
    risk_score: Mapped[int] = mapped_column(Integer)
    risk_level: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(
        String(20), default=FlagStatus.PENDING_REVIEW.value, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    last_reviewed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    transaction: Mapped[Transaction] = relationship(back_populates="flag")
    review_actions: Mapped[list[ReviewAction]] = relationship(
        back_populates="flag",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ReviewAction.id",
    )
    notification: Mapped[Notification | None] = relationship(
        back_populates="flag",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    reviewer: Mapped[User | None] = relationship(foreign_keys=[last_reviewed_by])

    def __repr__(self) -> str:
        return f"<FraudFlag {self.id} txn_pk={self.transaction_pk} {self.risk_level} {self.status}>"


class ReviewAction(Base):
    __tablename__ = "review_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    flag_id: Mapped[int] = mapped_column(
        ForeignKey("fraud_flags.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    from_status: Mapped[str] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    flag: Mapped[FraudFlag] = relationship(back_populates="review_actions")
    user: Mapped[User | None] = relationship()

    @property
    def username(self) -> str | None:
        return self.user.username if self.user is not None else None


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # UNIQUE + nullable: one alert per flag (de-duplication); NULL for test alerts.
    flag_id: Mapped[int | None] = mapped_column(
        ForeignKey("fraud_flags.id", ondelete="CASCADE"), unique=True, nullable=True
    )
    channel: Mapped[str] = mapped_column(String(10))
    target: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(10), index=True)
    subject: Mapped[str] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    flag: Mapped[FraudFlag | None] = relationship(back_populates="notification")

    @property
    def transaction_id(self) -> str | None:
        """External transaction id of the flagged transaction (None for test alerts)."""
        if self.flag is None or self.flag.transaction is None:
            return None
        return self.flag.transaction.transaction_id


class RuleConfig(Base):
    __tablename__ = "rule_configs"

    rule_name: Mapped[str] = mapped_column(String(64), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    score: Mapped[int] = mapped_column(Integer)
    params: Mapped[dict[str, Any]] = mapped_column(MutableDict.as_mutable(JSON), default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    updater: Mapped[User | None] = relationship()

    def __repr__(self) -> str:
        return f"<RuleConfig {self.rule_name} enabled={self.enabled} score={self.score}>"


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    user: Mapped[User | None] = relationship()

    @property
    def username(self) -> str | None:
        return self.user.username if self.user is not None else None


# Alias for modules that also import the engine's RuleResult dataclass
# (app.engine.base.RuleResult): ``from app.models import RuleResultRow``.
RuleResultRow = RuleResult
