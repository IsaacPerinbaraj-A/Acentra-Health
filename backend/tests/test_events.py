"""Event bus and handlers (plan Section 9, Section 20 test_events.py)."""

from __future__ import annotations

from sqlalchemy import select

from app.events.bus import EventBus
from app.events.events import (
    DataReset,
    FraudFlagged,
    RuleConfigUpdated,
    TransactionReceived,
    UserLoggedIn,
)
from app.models import AuditLog


def _received(n: int = 1) -> TransactionReceived:
    return TransactionReceived(transaction_id=f"T{n}", customer_id="C1", amount=10.0, source="api")


def test_handlers_run_in_registration_order_then_wildcard():
    bus = EventBus(feed_size=10)
    calls: list[str] = []
    bus.subscribe("*", lambda e, db: calls.append("star"))
    bus.subscribe(TransactionReceived, lambda e, db: calls.append("first"))
    bus.subscribe(TransactionReceived, lambda e, db: calls.append("second"))
    bus.publish(_received(), None)
    assert calls == ["first", "second", "star"]


def test_wildcard_handler_receives_every_event():
    bus = EventBus(feed_size=10)
    seen: list[str] = []
    bus.subscribe("*", lambda e, db: seen.append(e.name))
    bus.publish(_received(), None)
    bus.publish(UserLoggedIn(user_id=1, username="admin"), None)
    bus.publish(DataReset(user_id=None), None)
    assert seen == ["TransactionReceived", "UserLoggedIn", "DataReset"]


def test_failing_handler_does_not_stop_others_and_is_recorded():
    bus = EventBus(feed_size=10)
    calls: list[str] = []

    def boom(event, db):
        raise RuntimeError("kaboom")

    bus.subscribe(TransactionReceived, boom)
    bus.subscribe(TransactionReceived, lambda e, db: calls.append("after"))
    entry = bus.publish(_received(), None)  # must not raise
    assert calls == ["after"]
    assert len(entry["handler_errors"]) == 1
    assert "kaboom" in entry["handler_errors"][0]["error"]
    feed = bus.recent(1)[0]
    assert feed["name"] == "TransactionReceived"
    assert feed["handler_errors"] and "kaboom" in feed["handler_errors"][0]["error"]


def test_recent_is_newest_first_and_bounded():
    bus = EventBus(feed_size=3)
    for n in range(5):
        bus.publish(_received(n), None)
    recent = bus.recent(10)
    assert len(recent) == 3
    assert [e["payload"]["transaction_id"] for e in recent] == ["T4", "T3", "T2"]
    assert len(bus.recent(2)) == 2


def test_audit_rows_created_from_events(db, bus):
    bus.publish(UserLoggedIn(user_id=1, username="admin"), db)
    bus.publish(
        RuleConfigUpdated(rule_name="velocity", before={"score": 30}, after={"score": 40}, user_id=1),
        db,
    )
    bus.publish(_received(), db)  # not audited (too noisy)
    rows = list(db.scalars(select(AuditLog).order_by(AuditLog.id)))
    assert [r.action for r in rows] == ["UserLoggedIn", "RuleConfigUpdated"]
    assert (rows[0].entity_type, rows[0].entity_id, rows[0].user_id) == ("user", "1", 1)
    assert (rows[1].entity_type, rows[1].entity_id) == ("rule", "velocity")
    assert rows[1].details["after"] == {"score": 40}


def test_flag_events_audited_with_flag_entity(db, bus, engine, make_txn_payload):
    from app.services.ingest import ingest_transaction

    result = ingest_transaction(
        db, engine, bus, make_txn_payload(customer_id="CNEW", amount=75000, account_balance=500000), "api"
    )
    assert result.flag_id is not None
    row = db.scalars(select(AuditLog).where(AuditLog.action == FraudFlagged.__name__)).one()
    assert (row.entity_type, row.entity_id) == ("flag", str(result.flag_id))
    assert row.details["transaction_id"] == result.transaction.transaction_id


def test_ingestion_returns_201_when_notifier_handler_raises(
    client, api_key_headers, make_txn_payload, monkeypatch, bus
):
    import app.services.notifier as notifier

    def broken(*args, **kwargs):
        raise RuntimeError("notifier down")

    monkeypatch.setattr(notifier, "send_flag_alert", broken)
    first = make_txn_payload(customer_id="C777", city="Chennai", latitude=13.0827, longitude=80.2707,
                             timestamp="2026-10-01T10:00:00")
    second = make_txn_payload(customer_id="C777", city="Delhi", latitude=28.6139, longitude=77.2090,
                              timestamp="2026-10-01T10:30:00")
    assert client.post("/api/transactions", json=first, headers=api_key_headers).status_code == 201
    resp = client.post("/api/transactions", json=second, headers=api_key_headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["level"] == "HIGH"
    assert body["flag_id"] is not None
    assert body["notification_status"] is None
    high = [e for e in bus.recent(50) if e["name"] == "HighRiskDetected"][0]
    assert any("notifier down" in err["error"] for err in high["handler_errors"])
