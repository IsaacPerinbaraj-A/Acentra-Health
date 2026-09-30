"""The demo dataset reproduces plan Section 16.1 exactly."""

from __future__ import annotations

from collections import Counter

from sqlalchemy import func, select

from app.models import AuditLog, FraudFlag, Notification, Transaction
from app.models import RuleResult as RuleResultRow

EXPECTED = {
    "T009": (30, "MEDIUM", {"velocity"}),
    "T010": (30, "MEDIUM", {"velocity"}),
    "T014": (30, "MEDIUM", {"unusual_amount"}),
    "T016": (50, "HIGH", {"impossible_travel"}),
    "T020": (100, "CRITICAL", {"unusual_amount", "impossible_travel", "high_risk_merchant", "balance_drain"}),
    "T021": (30, "MEDIUM", {"unusual_amount"}),
    "T022": (20, "LOW", {"high_risk_merchant"}),
    "T028": (25, "MEDIUM", {"balance_drain"}),
    "T031": (40, "MEDIUM", {"shared_device"}),
    "T032": (40, "MEDIUM", {"shared_device"}),
}


def _fired(db, txn):
    return {
        r.rule_name
        for r in db.scalars(
            select(RuleResultRow).where(RuleResultRow.transaction_pk == txn.id, RuleResultRow.triggered.is_(True))
        )
    }


def test_demo_scores_and_levels(db, demo_loaded):
    txns = {t.transaction_id: t for t in db.scalars(select(Transaction))}
    assert len(txns) == 32
    for n in range(1, 33):
        tid = f"T{n:03d}"
        score, level, fired = EXPECTED.get(tid, (0, "LOW", set()))
        txn = txns[tid]
        assert (txn.risk_score, txn.risk_level) == (score, level), tid
        assert _fired(db, txn) == fired, tid


def test_t020_raw_score_125(db, demo_loaded):
    t020 = db.scalar(select(Transaction).where(Transaction.transaction_id == "T020"))
    raw = db.scalar(
        select(func.sum(RuleResultRow.score)).where(
            RuleResultRow.transaction_pk == t020.id, RuleResultRow.triggered.is_(True)
        )
    )
    assert raw == 125
    assert t020.risk_score == 100


def test_demo_flags_alerts_and_summary(db, demo_loaded):
    assert demo_loaded["processed"] == 32
    assert demo_loaded["flagged"] == 9
    assert demo_loaded["alerts"] == 2
    assert demo_loaded["skipped_duplicates"] == 0
    assert demo_loaded["errors"] == []
    flags = list(db.scalars(select(FraudFlag)))
    assert len(flags) == 9
    assert Counter(f.risk_level for f in flags) == {"MEDIUM": 7, "HIGH": 1, "CRITICAL": 1}
    assert {f.status for f in flags} == {"PENDING_REVIEW"}
    notifications = list(db.scalars(select(Notification)))
    assert len(notifications) == 2
    assert {n.status for n in notifications} == {"LOGGED"}
    alerted = {n.flag.transaction.transaction_id for n in notifications}
    assert alerted == {"T016", "T020"}


def test_demo_rule_fire_counts(db, demo_loaded):
    counts = dict(
        db.execute(
            select(RuleResultRow.rule_name, func.count(RuleResultRow.id))
            .where(RuleResultRow.triggered.is_(True))
            .group_by(RuleResultRow.rule_name)
        ).all()
    )
    assert counts == {
        "velocity": 2,
        "unusual_amount": 3,
        "impossible_travel": 2,
        "balance_drain": 2,
        "high_risk_merchant": 2,
        "shared_device": 2,
    }


def test_demo_audit_counts(db, demo_loaded):
    counts = Counter(db.scalars(select(AuditLog.action)))
    assert counts["FraudFlagged"] == 9
    assert counts["HighRiskDetected"] == 2
    assert counts["NotificationProcessed"] == 2
    assert counts["DemoLoaded"] == 1
    processed = db.scalars(select(AuditLog).where(AuditLog.action == "NotificationProcessed"))
    assert {row.details["status"] for row in processed} == {"LOGGED"}


def test_second_load_skips_everything(db, engine, bus, demo_loaded):
    from app.services.ingest import load_demo

    again = load_demo(db, engine, bus)
    assert again["processed"] == 0
    assert again["skipped_duplicates"] == 32
    assert again["flagged"] == 0 and again["alerts"] == 0
    assert db.scalar(select(func.count(Transaction.id))) == 32
    assert db.scalar(select(func.count(Notification.id))) == 2
