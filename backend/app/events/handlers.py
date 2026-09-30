"""Event handlers wired onto the EventBus (plan Section 9.3).

| Handler             | Subscribes to                                   |
|---------------------|-------------------------------------------------|
| audit_handler       | every event except TransactionReceived /        |
|                     | TransactionEvaluated (too noisy)                |
| notify_on_high_risk | HighRiskDetected -> notifier.send_flag_alert,   |
|                     | then publishes NotificationProcessed            |

``audit_handler`` is subscribed first so that, for HighRiskDetected, the audit
row of the event is written before the alert attempt (and its
NotificationProcessed audit row). The live feed is built into ``bus.publish``.
"""

from __future__ import annotations

import logging
from typing import Any

from app.events.events import (
    ALL_EVENTS,
    Event,
    HighRiskDetected,
    NotificationProcessed,
    RuleConfigUpdated,
    TransactionEvaluated,
    TransactionReceived,
    UserLoggedIn,
)

logger = logging.getLogger(__name__)

__all__ = ["register_handlers", "audit_handler", "AUDIT_SKIPPED_EVENTS", "audit_entity"]

AUDIT_SKIPPED_EVENTS: tuple[type[Event], ...] = (TransactionReceived, TransactionEvaluated)


def audit_entity(event: Event) -> tuple[str | None, str | None]:
    """(entity_type, entity_id) for the audit row of `event`."""
    if isinstance(event, RuleConfigUpdated):
        return "rule", event.rule_name
    if isinstance(event, UserLoggedIn):
        return "user", str(event.user_id)
    flag_id = getattr(event, "flag_id", None)
    if flag_id is not None:
        return "flag", str(flag_id)
    return None, None


def audit_handler(event: Event, db: Any) -> None:
    """Write one audit_logs row: action = event name, details = payload."""
    from app.services.audit import write_audit

    entity_type, entity_id = audit_entity(event)
    write_audit(
        db,
        action=event.name,
        details=event.payload(),
        user_id=getattr(event, "user_id", None),
        entity_type=entity_type,
        entity_id=entity_id,
    )


def register_handlers(bus) -> None:
    """Subscribe every side-effect handler to `bus`.

    Called once by app startup (main.py lifespan), by the CLI and by the test
    fixtures, each with their own EventBus instance.
    """
    for event_cls in ALL_EVENTS:
        if event_cls in AUDIT_SKIPPED_EVENTS:
            continue
        bus.subscribe(event_cls, audit_handler)

    def notify_on_high_risk(event: HighRiskDetected, db: Any) -> None:
        from app.services.notifier import send_flag_alert

        notification = send_flag_alert(db, event.flag_id)
        db.commit()
        bus.publish(
            NotificationProcessed(
                flag_id=event.flag_id,
                channel=str(notification.channel),
                status=str(notification.status),
                error=notification.error,
            ),
            db,
        )

    bus.subscribe(HighRiskDetected, notify_on_high_risk)
