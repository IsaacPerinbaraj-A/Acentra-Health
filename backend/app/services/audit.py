"""Audit log writer (plan Section 6 `audit_logs`, Section 9.3).

Every audit row is written by the audit event handler, so the audit log is a
record of the events that happened. ``write_audit`` only adds + flushes; the
caller (the event bus) commits.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.events.events import to_jsonable
from app.models import AuditLog

__all__ = ["write_audit"]


def write_audit(
    db: Session,
    action: str,
    details: dict[str, Any] | None,
    user_id: int | None = None,
    entity_type: str | None = None,
    entity_id: Any = None,
) -> AuditLog:
    """Add one audit_logs row (flushed, not committed) and return it."""
    row = AuditLog(
        user_id=user_id,
        action=str(action),
        entity_type=entity_type,
        entity_id=None if entity_id is None else str(entity_id),
        details=to_jsonable(details or {}),
    )
    db.add(row)
    db.flush()
    return row
