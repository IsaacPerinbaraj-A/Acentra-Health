"""Ingestion pipeline (plan Section 10, Section 20 test_ingest.py)."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import func, select

from app.models import FraudFlag, Transaction
from app.models import RuleResult as RuleResultRow
from app.services.ingest import (
    DuplicateTransaction,
    ingest_batch,
    ingest_transaction,
    load_history,
    parse_csv,
)


def _travel_pair(make, customer="C500"):
    first = make(customer_id=customer, city="Chennai", latitude=13.0827, longitude=80.2707,
                 timestamp="2026-10-01T10:00:00")
    second = make(customer_id=customer, city="Delhi", latitude=28.6139, longitude=77.2090,
                  timestamp="2026-10-01T10:30:00")
    return first, second


def test_rule_results_stored_for_every_rule(db, bus, engine, make_txn_payload):
    result = ingest_transaction(db, engine, bus, make_txn_payload(), "api")
    rows = list(
        db.scalars(select(RuleResultRow).where(RuleResultRow.transaction_pk == result.transaction.id))
    )
    assert {r.rule_name for r in rows} == set(engine.names)
    assert all(r.reason for r in rows)
    assert result.level == "LOW" and result.score == 0
    assert result.flag_id is None


def test_flag_only_at_medium_or_above(db, bus, engine, make_txn_payload):
    low = ingest_transaction(db, engine, bus, make_txn_payload(merchant="CryptoXchange"), "api")
    assert low.level == "LOW" and low.score == 20
    assert low.flag_id is None
    medium = ingest_transaction(
        db, engine, bus, make_txn_payload(customer_id="C601", amount=75000, account_balance=500000), "api"
    )
    assert medium.level == "MEDIUM"
    flag = db.get(FraudFlag, medium.flag_id)
    assert flag.status == "PENDING_REVIEW" and flag.risk_score == medium.score
    assert db.scalar(select(func.count(FraudFlag.id))) == 1


def test_duplicate_raises(db, bus, engine, make_txn_payload):
    payload = make_txn_payload(transaction_id="DUP1")
    ingest_transaction(db, engine, bus, payload, "api")
    with pytest.raises(DuplicateTransaction):
        ingest_transaction(db, engine, bus, payload, "api")
    assert db.scalar(select(func.count(Transaction.id))) == 1


def test_duplicate_api_returns_409(client, api_key_headers, make_txn_payload):
    payload = make_txn_payload(transaction_id="DUP2")
    assert client.post("/api/transactions", json=payload, headers=api_key_headers).status_code == 201
    assert client.post("/api/transactions", json=payload, headers=api_key_headers).status_code == 409


def test_out_of_order_uses_only_earlier_history(db, bus, engine, make_txn_payload):
    later = make_txn_payload(customer_id="C700", city="Delhi", latitude=28.6139, longitude=77.2090,
                             timestamp="2026-10-01T12:00:00")
    earlier = make_txn_payload(customer_id="C700", city="Chennai", latitude=13.0827, longitude=80.2707,
                               timestamp="2026-10-01T11:30:00")
    ingest_transaction(db, engine, bus, later, "api")
    result = ingest_transaction(db, engine, bus, earlier, "api")
    travel = [r for r in result.results if r.rule_name == "impossible_travel"][0]
    assert not travel.triggered  # the later Delhi payment is not "previous"
    assert load_history(db, "C700", datetime(2026, 10, 1, 11, 30), 200) == []
    history = load_history(db, "C700", datetime(2026, 10, 1, 13, 0), 200)
    assert [t.transaction_id for t in history] == [earlier["transaction_id"], later["transaction_id"]]


def test_history_limit_keeps_most_recent_ascending(db, bus, engine, make_txn_payload):
    ids = [ingest_transaction(db, engine, bus, make_txn_payload(customer_id="C701"), "api").transaction.transaction_id
           for _ in range(4)]
    history = load_history(db, "C701", datetime(2027, 1, 1), 2)
    assert [t.transaction_id for t in history] == ids[2:]


def test_events_published_in_documented_order(db, bus, engine, make_txn_payload):
    first, second = _travel_pair(make_txn_payload)
    ingest_transaction(db, engine, bus, first, "api")
    bus.clear_feed()
    result = ingest_transaction(db, engine, bus, second, "api")
    assert result.level == "HIGH"
    names = [e["name"] for e in reversed(bus.recent(20))]
    assert names == [
        "TransactionReceived",
        "TransactionEvaluated",
        "FraudFlagged",
        "HighRiskDetected",
        "NotificationProcessed",
    ]
    assert result.notification_status == "LOGGED"
    received = bus.recent(20)[-1]
    assert received["payload"]["source"] == "api"


def test_bulk_batch_continues_past_bad_rows(db, bus, engine, make_txn_payload):
    good1 = make_txn_payload(timestamp="2026-10-02T10:00:00")
    bad = make_txn_payload(amount=-5)
    missing = {"transaction_id": "NOCUST", "amount": 10}
    good2 = make_txn_payload(timestamp="2026-10-02T09:00:00")
    summary = ingest_batch(db, engine, bus, [good1, bad, missing, good2, good1], "api")
    assert summary["processed"] == 2
    assert summary["skipped_duplicates"] == 1
    assert [e["row"] for e in summary["errors"]] == [2, 3]
    assert summary["errors"][0]["transaction_id"] == bad["transaction_id"]
    # sorted by timestamp: good2 (09:00) before good1 (10:00)
    assert [t["transaction_id"] for t in summary["transactions"]] == [
        good2["transaction_id"],
        good1["transaction_id"],
    ]
    assert set(summary) == {"processed", "flagged", "alerts", "skipped_duplicates", "errors", "transactions"}


def test_parse_csv_rules():
    content = (
        "﻿customer_id,transaction_id,amount,timestamp,merchant,extra\n"
        "C1,A1,100,2026-10-01T09:00:00,,x\n"
        "C1,A2,,2026-10-01T09:05:00,Shop,y\n"
    ).encode("utf-8")
    rows, errors = parse_csv(content)
    assert len(rows) == 1
    assert rows[0]["transaction_id"] == "A1" and rows[0]["merchant"] is None
    assert "extra" not in rows[0]
    assert errors == [{"row": 3, "transaction_id": "A2", "error": "Missing required value(s): amount"}]
    with pytest.raises(ValueError):
        parse_csv(b"transaction_id,amount\nA1,5\n")
    with pytest.raises(ValueError):
        parse_csv(b"")


def test_api_ingest_and_upload(client, api_key_headers, auth_headers, make_txn_payload):
    resp = client.post("/api/transactions", json=make_txn_payload(), headers=api_key_headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert set(body) == {"transaction", "score", "raw_score", "level", "results", "flag_id", "notification_status"}
    assert {"rule_name", "display_name", "description", "triggered", "score", "reason", "details"} <= set(
        body["results"][0]
    )
    assert client.post("/api/transactions", json={"transaction_id": "X"}, headers=api_key_headers).status_code == 422

    csv_bytes = (
        "transaction_id,customer_id,amount,timestamp\n"
        "U1,C11,100,2026-10-01T09:00:00\n"
        "U2,C11,oops,2026-10-01T09:10:00\n"
    ).encode()
    resp = client.post(
        "/api/transactions/upload",
        files={"file": ("t.csv", csv_bytes, "text/csv")},
        headers=auth_headers("ADMIN"),
    )
    assert resp.status_code == 200, resp.text
    summary = resp.json()
    assert summary["processed"] == 1 and len(summary["errors"]) == 1 and summary["errors"][0]["row"] == 3
    bad = client.post(
        "/api/transactions/upload",
        files={"file": ("t.csv", b"foo,bar\n1,2\n", "text/csv")},
        headers=auth_headers("ADMIN"),
    )
    assert bad.status_code == 400
    listing = client.get("/api/transactions?q=u1", headers=auth_headers("VIEWER")).json()
    assert listing["total"] == 1 and listing["items"][0]["transaction_id"] == "U1"
    detail = client.get("/api/transactions/U1", headers=auth_headers("VIEWER"))
    assert detail.status_code == 200 and detail.json()["flag_id"] is None
    assert client.get("/api/transactions/NOPE", headers=auth_headers("VIEWER")).status_code == 404
