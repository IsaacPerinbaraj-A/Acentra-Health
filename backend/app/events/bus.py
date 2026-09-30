"""Synchronous in-process event bus (plan Section 9.1).

    bus = EventBus()
    bus.subscribe(HighRiskDetected, notify_on_high_risk)   # handler(event, db)
    bus.subscribe("*", audit_handler)                     # every event
    bus.publish(HighRiskDetected(...), db)

* ``publish`` runs the handlers subscribed to the event's exact type, then the
  ``"*"`` handlers, each group in registration order.
* Each handler runs in its own try/except: success -> ``db.commit()``; error ->
  ``db.rollback()``, ``logger.exception`` and the error is recorded in the feed
  entry. A failing handler never affects other handlers or the publisher.
* Handlers may publish further events (re-entrant publish is supported). The
  feed entry of the outer event is appended *before* its handlers run, so the
  feed stays in causal order (HighRiskDetected before NotificationProcessed).
* ``recent(limit)`` returns the in-memory feed, newest first:
  ``{"name", "occurred_at" (ISO str), "payload", "handler_errors": [{"handler", "error"}]}``
"""

from __future__ import annotations

import logging
from collections import deque
from collections.abc import Callable
from typing import Any, Literal

from app.events.events import Event

logger = logging.getLogger(__name__)

Handler = Callable[[Event, Any], None]
WILDCARD = "*"


def _handler_name(handler: Handler) -> str:
    return getattr(handler, "__qualname__", None) or getattr(handler, "__name__", None) or repr(handler)


class EventBus:
    def __init__(self, feed_size: int | None = None) -> None:
        if feed_size is None:
            from app.config import get_settings

            feed_size = get_settings().EVENT_FEED_SIZE
        self._handlers: dict[type[Event] | str, list[Handler]] = {}
        self._feed: deque[dict[str, Any]] = deque(maxlen=max(1, int(feed_size)))

    # ------------------------------------------------------------ subscribe
    def subscribe(self, event_type: type[Event] | Literal["*"], handler: Handler) -> None:
        """Register `handler(event, db)` for an Event subclass or "*" (all events)."""
        if event_type != WILDCARD and not (
            isinstance(event_type, type) and issubclass(event_type, Event)
        ):
            raise ValueError(f"event_type must be an Event subclass or '*', got {event_type!r}")
        if not callable(handler):
            raise ValueError("handler must be callable")
        self._handlers.setdefault(event_type, []).append(handler)

    def handlers_for(self, event_type: type[Event]) -> list[Handler]:
        """Handlers that would run for `event_type`, in call order."""
        return list(self._handlers.get(event_type, [])) + list(self._handlers.get(WILDCARD, []))

    # ------------------------------------------------------------ publish
    def publish(self, event: Event, db: Any = None) -> dict[str, Any]:
        """Run the handlers for `event` and record it in the feed. Returns the feed entry."""
        entry: dict[str, Any] = {
            "name": event.name,
            "occurred_at": event.occurred_at.isoformat(),
            "payload": event.payload(),
            "handler_errors": [],
        }
        self._feed.append(entry)

        for handler in self.handlers_for(type(event)):
            try:
                handler(event, db)
                if db is not None:
                    db.commit()
            except Exception as exc:  # noqa: BLE001 - a handler must never break the caller
                if db is not None:
                    try:
                        db.rollback()
                    except Exception:  # noqa: BLE001
                        logger.exception("Rollback failed after handler error")
                name = _handler_name(handler)
                logger.exception("Event handler %s failed for %s", name, event.name)
                entry["handler_errors"].append(
                    {"handler": name, "error": f"{type(exc).__name__}: {exc}"}
                )
        return entry

    # ------------------------------------------------------------ introspection
    def recent(self, limit: int = 100) -> list[dict[str, Any]]:
        """Newest-first copy of the last `limit` feed entries."""
        if limit is None or limit <= 0:
            return []
        items = list(self._feed)[-limit:]
        items.reverse()
        return [
            {**item, "handler_errors": list(item["handler_errors"])} for item in items
        ]

    def handler_counts(self) -> dict[str, int]:
        """{event name or "*": number of subscribed handlers} (used by /api/health)."""
        counts: dict[str, int] = {}
        for key, handlers in self._handlers.items():
            name = key if isinstance(key, str) else key.__name__
            counts[name] = len(handlers)
        return counts

    def clear_feed(self) -> None:
        self._feed.clear()

    @property
    def feed_size(self) -> int:
        return self._feed.maxlen or 0
