"""Fraud alert notifier (plan Section 11).

``send_flag_alert(db, flag_id)`` is called only by the HighRiskDetected handler.
It never raises: every failure is stored as a FAILED notification row. One
notification per flag (de-duplication by the unique ``notifications.flag_id``).

Channels (``NOTIFY_MODE``): ``log`` -> logger.warning, status LOGGED;
``sns`` -> SNS publish, status SENT; ``ses`` -> SES send_email, status SENT.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.enums import NotificationStatus
from app.models import FraudFlag, Notification
from app.models import RuleResult as RuleResultRow

logger = logging.getLogger("app.notifier")

__all__ = [
    "send_flag_alert",
    "send_test_alert",
    "serialize_notification",
    "build_flag_alert",
    "deliver",
]

TEST_SUBJECT = "[FRAUD ALERT] Test alert from RiskLens"


def _aws_config():
    from botocore.config import Config

    return Config(connect_timeout=3, read_timeout=5, retries={"max_attempts": 1})


def _display_names() -> dict[str, str]:
    try:
        from app.engine.engine import rule_meta
        from app.engine.registry import discover_rules

        return {name: rule_meta(cls)["display_name"] for name, cls in discover_rules().items()}
    except Exception:  # noqa: BLE001
        return {}


def _fmt_amount(amount: float | None, currency: str | None) -> str:
    value = float(amount or 0)
    text = f"{value:,.0f}" if value.is_integer() else f"{value:,.2f}"
    return f"{text} {currency or 'INR'}"


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _mode(settings: Settings) -> str:
    return (settings.NOTIFY_MODE or "log").strip().lower()


def build_flag_alert(db: Session, flag: FraudFlag, settings: Settings) -> tuple[str, str]:
    """(subject, plain-text body) for a flag alert."""
    txn = flag.transaction
    subject = f"[FRAUD ALERT] {flag.risk_level} risk {flag.risk_score}/100 — {txn.transaction_id}"
    fired = list(
        db.scalars(
            select(RuleResultRow)
            .where(RuleResultRow.transaction_pk == txn.id, RuleResultRow.triggered.is_(True))
            .order_by(RuleResultRow.score.desc(), RuleResultRow.rule_name)
        )
    )
    names = _display_names() if fired else {}
    lines = [
        "A transaction was flagged by RiskLens.",
        "",
        f"Transaction: {txn.transaction_id}",
        f"Customer: {txn.customer_id}",
        f"Amount: {_fmt_amount(txn.amount, txn.currency)}",
        f"Merchant: {txn.merchant or '-'}",
        f"City: {txn.city or '-'}",
        f"Timestamp: {_iso(txn.timestamp)}",
        f"Score: {flag.risk_score}/100",
        f"Level: {flag.risk_level}",
        "",
        "Rules fired:",
    ]
    if fired:
        for row in fired:
            label = names.get(row.rule_name, row.rule_name)
            lines.append(f"- {label} (+{row.score}): {row.reason}")
    else:
        lines.append("- none")
    base = (settings.CONSOLE_BASE_URL or "").rstrip("/")
    lines += ["", f"Review: {base}/flags/{flag.id}"]
    return subject, "\n".join(lines)


def deliver(subject: str, body: str, settings: Settings) -> tuple[str, str | None, str, str | None]:
    """Send via NOTIFY_MODE. Returns (channel, target, status, error). Never raises."""
    mode = _mode(settings)
    channel = mode[:10] or "log"
    target: str | None = None
    try:
        if mode == "log":
            logger.warning("%s\n%s", subject, body)
            return channel, None, NotificationStatus.LOGGED.value, None
        if mode == "sns":
            if not settings.SNS_TOPIC_ARN:
                return channel, None, NotificationStatus.FAILED.value, "SNS_TOPIC_ARN not configured"
            target = settings.SNS_TOPIC_ARN
            import boto3

            client = boto3.client("sns", region_name=settings.AWS_REGION, config=_aws_config())
            client.publish(TopicArn=settings.SNS_TOPIC_ARN, Subject=subject[:100], Message=body)
            return channel, target, NotificationStatus.SENT.value, None
        if mode == "ses":
            recipients = [r.strip() for r in (settings.SES_RECIPIENTS or "").split(",") if r.strip()]
            target = ",".join(recipients) or None
            missing = []
            if not settings.SES_SENDER:
                missing.append("SES_SENDER")
            if not recipients:
                missing.append("SES_RECIPIENTS")
            if missing:
                error = " and ".join(missing) + " not configured"
                return channel, target, NotificationStatus.FAILED.value, error
            import boto3

            client = boto3.client("ses", region_name=settings.AWS_REGION, config=_aws_config())
            client.send_email(
                Source=settings.SES_SENDER,
                Destination={"ToAddresses": recipients},
                Message={
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
                },
            )
            return channel, target, NotificationStatus.SENT.value, None
        error = f"Unknown NOTIFY_MODE {settings.NOTIFY_MODE!r}"
        return channel, None, NotificationStatus.FAILED.value, error
    except Exception as exc:  # noqa: BLE001 - alerts never break the caller
        logger.exception("Alert delivery via %s failed", mode)
        return channel, target, NotificationStatus.FAILED.value, str(exc) or type(exc).__name__


def _store(db: Session, **fields: Any) -> Notification:
    row = Notification(**fields)
    db.add(row)
    db.commit()
    return row


def _transient_failure(flag_id: int | None, settings: Settings, error: str) -> Notification:
    return Notification(
        flag_id=flag_id,
        channel=_mode(settings)[:10] or "log",
        target=None,
        status=NotificationStatus.FAILED.value,
        subject=f"[FRAUD ALERT] flag {flag_id}",
        message="",
        error=error,
    )


def send_flag_alert(db: Session, flag_id: int, settings: Settings | None = None) -> Notification:
    """Send (once) the alert for `flag_id`; store and return the notifications row. Never raises."""
    settings = settings or get_settings()
    try:
        existing = db.scalar(select(Notification).where(Notification.flag_id == flag_id))
        if existing is not None:
            return existing
        flag = db.get(FraudFlag, flag_id)
        if flag is None:
            return _transient_failure(None, settings, f"Flag {flag_id} not found")
        try:
            subject, body = build_flag_alert(db, flag, settings)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Could not build alert for flag %s", flag_id)
            return _store(
                db,
                flag_id=flag_id,
                channel=_mode(settings)[:10] or "log",
                target=None,
                status=NotificationStatus.FAILED.value,
                subject=f"[FRAUD ALERT] flag {flag_id}",
                message="",
                error=str(exc),
            )
        channel, target, status, error = deliver(subject, body, settings)
        try:
            return _store(
                db,
                flag_id=flag_id,
                channel=channel,
                target=target,
                status=status,
                subject=subject[:255],
                message=body,
                error=error,
            )
        except IntegrityError:
            db.rollback()
            existing = db.scalar(select(Notification).where(Notification.flag_id == flag_id))
            if existing is not None:
                return existing
            raise
    except Exception as exc:  # noqa: BLE001 - never re-raise
        logger.exception("send_flag_alert failed for flag %s", flag_id)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return _transient_failure(flag_id, settings, str(exc))


def send_test_alert(
    db: Session, user_id: int | None = None, settings: Settings | None = None
) -> Notification:
    """Send a fixed test message through the configured channel (flag_id NULL). Never raises."""
    settings = settings or get_settings()
    body = "\n".join(
        [
            "This is a test alert from RiskLens.",
            "If you received it, fraud alerts are configured correctly.",
            f"Channel: {_mode(settings)}",
            f"Requested by user id: {user_id if user_id is not None else '-'}",
            f"Console: {(settings.CONSOLE_BASE_URL or '').rstrip('/')}",
        ]
    )
    channel, target, status, error = deliver(TEST_SUBJECT, body, settings)
    try:
        return _store(
            db,
            flag_id=None,
            channel=channel,
            target=target,
            status=status,
            subject=TEST_SUBJECT,
            message=body,
            error=error,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Could not store test alert")
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return Notification(
            flag_id=None,
            channel=channel,
            target=target,
            status=NotificationStatus.FAILED.value,
            subject=TEST_SUBJECT,
            message=body,
            error=str(exc),
        )


def serialize_notification(n: Notification) -> dict[str, Any]:
    """NotificationOut dict (docs/API_CONTRACT.md)."""
    transaction_id = None
    if n.flag_id is not None:
        flag = n.flag
        if flag is not None and flag.transaction is not None:
            transaction_id = flag.transaction.transaction_id
    return {
        "id": n.id,
        "flag_id": n.flag_id,
        "transaction_id": transaction_id,
        "channel": n.channel,
        "target": n.target,
        "status": str(n.status) if n.status is not None else None,
        "subject": n.subject,
        "message": n.message,
        "error": n.error,
        "created_at": _iso(n.created_at),
    }
