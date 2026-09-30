"""Notifier (plan Section 11, Section 20 test_notifier.py)."""

from __future__ import annotations

from sqlalchemy import func, select

from app.events.events import HighRiskDetected
from app.models import AuditLog, Notification
from app.services.ingest import ingest_transaction
from app.services.notifier import send_flag_alert


def _high_risk(db, engine, bus, make, customer="C800"):
    first = make(customer_id=customer, city="Chennai", latitude=13.0827, longitude=80.2707,
                 timestamp="2026-10-01T10:00:00")
    second = make(customer_id=customer, city="Delhi", latitude=28.6139, longitude=77.2090,
                  timestamp="2026-10-01T10:30:00")
    ingest_transaction(db, engine, bus, first, "api")
    return ingest_transaction(db, engine, bus, second, "api"), second


def test_log_mode_logged(db, engine, bus, make_txn_payload, settings):
    result, payload = _high_risk(db, engine, bus, make_txn_payload)
    assert result.level == "HIGH"
    assert result.notification_status == "LOGGED"
    n = db.scalar(select(Notification).where(Notification.flag_id == result.flag_id))
    assert n.channel == "log" and n.error is None
    assert n.subject == f"[FRAUD ALERT] HIGH risk 50/100 — {payload['transaction_id']}"
    assert "Impossible travel" in n.message or "impossible_travel" in n.message
    assert n.message.rstrip().endswith(f"/flags/{result.flag_id}")
    assert f"Review: {settings.CONSOLE_BASE_URL.rstrip('/')}/flags/{result.flag_id}" in n.message


def test_demo_t020_subject(db, demo_loaded):
    subjects = set(db.scalars(select(Notification.subject)))
    assert "[FRAUD ALERT] CRITICAL risk 100/100 — T020" in subjects


def test_sns_with_moto_sent(db, engine, bus, make_txn_payload, settings, monkeypatch):
    import boto3
    from moto import mock_aws

    for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SECURITY_TOKEN", "AWS_SESSION_TOKEN"):
        monkeypatch.setenv(key, "testing")
    with mock_aws():
        arn = boto3.client("sns", region_name=settings.AWS_REGION).create_topic(Name="fraud-alerts")["TopicArn"]
        monkeypatch.setattr(settings, "NOTIFY_MODE", "sns")
        monkeypatch.setattr(settings, "SNS_TOPIC_ARN", arn)
        result, _ = _high_risk(db, engine, bus, make_txn_payload, customer="C801")
    assert result.notification_status == "SENT"
    n = db.scalar(select(Notification).where(Notification.flag_id == result.flag_id))
    assert (n.channel, n.target, n.error) == ("sns", arn, None)


def test_sns_missing_arn_failed_and_ingestion_201(client, api_key_headers, make_txn_payload, settings, monkeypatch, db):
    monkeypatch.setattr(settings, "NOTIFY_MODE", "sns")
    monkeypatch.setattr(settings, "SNS_TOPIC_ARN", "")
    first = make_txn_payload(customer_id="C802", city="Chennai", latitude=13.0827, longitude=80.2707,
                             timestamp="2026-10-01T10:00:00")
    second = make_txn_payload(customer_id="C802", city="Delhi", latitude=28.6139, longitude=77.2090,
                              timestamp="2026-10-01T10:30:00")
    assert client.post("/api/transactions", json=first, headers=api_key_headers).status_code == 201
    resp = client.post("/api/transactions", json=second, headers=api_key_headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["notification_status"] == "FAILED"
    n = db.scalar(select(Notification).where(Notification.flag_id == resp.json()["flag_id"]))
    assert n.status == "FAILED" and n.error == "SNS_TOPIC_ARN not configured"


def test_ses_missing_config_failed(db, engine, bus, make_txn_payload, settings, monkeypatch):
    monkeypatch.setattr(settings, "NOTIFY_MODE", "ses")
    monkeypatch.setattr(settings, "SES_SENDER", "")
    monkeypatch.setattr(settings, "SES_RECIPIENTS", "")
    result, _ = _high_risk(db, engine, bus, make_txn_payload, customer="C803")
    assert result.notification_status == "FAILED"


def test_one_notification_per_flag(db, engine, bus, make_txn_payload):
    result, payload = _high_risk(db, engine, bus, make_txn_payload, customer="C804")
    event = HighRiskDetected(flag_id=result.flag_id, transaction_id=payload["transaction_id"],
                             score=result.score, level=result.level)
    bus.publish(event, db)
    again = send_flag_alert(db, result.flag_id)
    assert db.scalar(select(func.count(Notification.id)).where(Notification.flag_id == result.flag_id)) == 1
    assert again.flag_id == result.flag_id


def test_medium_creates_no_notification(db, engine, bus, make_txn_payload):
    result = ingest_transaction(
        db, engine, bus, make_txn_payload(customer_id="C805", amount=75000, account_balance=500000), "api"
    )
    assert result.level == "MEDIUM" and result.flag_id is not None
    assert result.notification_status is None
    assert db.scalar(select(func.count(Notification.id))) == 0


def test_send_flag_alert_never_raises_for_unknown_flag(db):
    n = send_flag_alert(db, 999999)
    assert n.status == "FAILED"


def test_notifications_api(client, auth_headers, db):
    resp = client.post("/api/notifications/test", headers=auth_headers("ADMIN"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["flag_id"] is None and body["status"] == "LOGGED" and body["transaction_id"] is None
    assert db.scalar(select(func.count(AuditLog.id)).where(AuditLog.action == "TestAlertSent")) == 1
    listing = client.get("/api/notifications", headers=auth_headers("ADMIN")).json()
    assert listing["total"] == 1 and listing["items"][0]["id"] == body["id"]
    assert client.get("/api/notifications", headers=auth_headers("VIEWER")).status_code == 403
    assert client.post("/api/notifications/test", headers=auth_headers("REVIEWER")).status_code == 403
