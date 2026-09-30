"""Evaluation pipeline (plan Section 10).

``ingest_transaction`` runs steps 1-9 in one DB transaction (validate, duplicate
check, history, insert + flush, evaluate, score, rule_results, flag, commit),
then publishes the events of step 10 in order: TransactionReceived,
TransactionEvaluated, FraudFlagged (if flagged), HighRiskDetected (if level >=
ALERT_MIN_LEVEL). Alerts are sent by the HighRiskDetected handler, after the
commit, so a delivery failure can never lose the transaction or the flag.

Bulk ingestion (CSV, demo, simulator) validates every row, sorts the valid rows
by timestamp and ingests them one by one; one bad row never stops the batch.
"""

from __future__ import annotations

import csv
import io
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import DEMO_CSV_PATH, get_settings
from app.database import utcnow
from app.engine.base import RuleContext
from app.engine.base import RuleResult as EngineRuleResult
from app.engine.engine import RuleEngine, rule_meta
from app.engine.scoring import raw_score as compute_raw_score
from app.engine.scoring import risk_level, total_score
from app.enums import FlagStatus, RiskLevel, level_gte
from app.events.events import (
    CsvUploaded,
    DataReset,
    DemoLoaded,
    FraudFlagged,
    HighRiskDetected,
    TransactionEvaluated,
    TransactionReceived,
    to_jsonable,
)
from app.models import AuditLog  # noqa: F401  (kept: reset keeps the audit log)
from app.models import FraudFlag, Notification, ReviewAction, Transaction
from app.models import RuleResult as RuleResultRow
from app.seed import load_rule_configs

logger = logging.getLogger(__name__)

__all__ = [
    "DuplicateTransaction",
    "IngestResult",
    "CSV_COLUMNS",
    "REQUIRED_COLUMNS",
    "MAX_BULK_ROWS",
    "MAX_UPLOAD_BYTES",
    "ingest_transaction",
    "ingest_batch",
    "parse_csv",
    "load_demo",
    "import_csv",
    "reset_data",
    "load_history",
    "serialize_transaction",
    "serialize_result",
    "format_error",
]

CSV_COLUMNS = (
    "transaction_id",
    "customer_id",
    "amount",
    "currency",
    "merchant",
    "city",
    "latitude",
    "longitude",
    "timestamp",
    "device_id",
    "account_balance",
)
REQUIRED_COLUMNS = ("transaction_id", "customer_id", "amount", "timestamp")
MAX_BULK_ROWS = 1000
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ROW_KEY = "_row"  # internal: source row number carried with CSV rows


class DuplicateTransaction(Exception):
    """A transaction with this transaction_id already exists (API -> 409)."""

    def __init__(self, transaction_id: str):
        self.transaction_id = transaction_id
        super().__init__(f"Transaction {transaction_id} already exists")


@dataclass
class IngestResult:
    transaction: Transaction
    results: list[EngineRuleResult] = field(default_factory=list)
    score: int = 0
    raw_score: int = 0
    level: str = RiskLevel.LOW.value
    flag_id: int | None = None
    notification_status: str | None = None

    @property
    def fired_rules(self) -> list[str]:
        return [r.rule_name for r in self.results if r.triggered]


# ---------------------------------------------------------------- helpers


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _naive_utc(value: datetime) -> datetime:
    """Section 6.1: offset-aware -> UTC naive; naive stays as given."""
    if value.tzinfo is not None and value.utcoffset() is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.replace(tzinfo=None)


def format_error(exc: Exception) -> str:
    """Readable one-line error for batch summaries."""
    if isinstance(exc, ValidationError):
        parts = []
        for err in exc.errors():
            loc = ".".join(str(p) for p in err.get("loc", ()) if p != "body")
            msg = err.get("msg", "invalid")
            parts.append(f"{loc}: {msg}" if loc else msg)
        return "; ".join(parts) or "Invalid transaction"
    return str(exc) or type(exc).__name__


def _to_payload(payload: Any):
    """Validate `payload` (TransactionIn, pydantic model or dict) into TransactionIn."""
    from app.schemas import TransactionIn

    if isinstance(payload, TransactionIn):
        return payload
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump()
    if isinstance(payload, dict):
        # empty cells / nulls fall back to the schema defaults (e.g. currency INR)
        payload = {k: v for k, v in payload.items() if k != ROW_KEY and v is not None}
    return TransactionIn.model_validate(payload)


def _normalise(p: Any) -> dict[str, Any]:
    """Section 10 step 1: field dict for the Transaction row (validated again defensively)."""
    data = p.model_dump() if hasattr(p, "model_dump") else dict(p)
    ts = data.get("timestamp")
    if isinstance(ts, str):
        ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if not isinstance(ts, datetime):
        raise ValueError("timestamp: must be an ISO 8601 datetime")
    amount = float(data["amount"])
    if not amount > 0:
        raise ValueError("amount: must be greater than 0")
    lat, lon = data.get("latitude"), data.get("longitude")
    if lat is not None and not -90 <= float(lat) <= 90:
        raise ValueError("latitude: must be between -90 and 90")
    if lon is not None and not -180 <= float(lon) <= 180:
        raise ValueError("longitude: must be between -180 and 180")
    balance = data.get("account_balance")
    if balance is not None and float(balance) < 0:
        raise ValueError("account_balance: must be >= 0")
    currency = (data.get("currency") or "INR").strip().upper() or "INR"
    return {
        "transaction_id": str(data["transaction_id"]).strip(),
        "customer_id": str(data["customer_id"]).strip(),
        "amount": amount,
        "currency": currency,
        "merchant": data.get("merchant") or None,
        "city": data.get("city") or None,
        "latitude": None if lat is None else float(lat),
        "longitude": None if lon is None else float(lon),
        "timestamp": _naive_utc(ts),
        "device_id": data.get("device_id") or None,
        "account_balance": None if balance is None else float(balance),
    }


def _exists(db: Session, transaction_id: str) -> bool:
    return (
        db.scalar(select(Transaction.id).where(Transaction.transaction_id == transaction_id))
        is not None
    )


def load_history(
    db: Session, customer_id: str, before_ts: datetime, limit: int | None = None
) -> list[Transaction]:
    """Same customer, timestamp < before_ts, the last `limit` rows, ascending by time."""
    if limit is None:
        limit = get_settings().HISTORY_LIMIT
    rows = list(
        db.scalars(
            select(Transaction)
            .where(Transaction.customer_id == customer_id, Transaction.timestamp < before_ts)
            .order_by(Transaction.timestamp.desc(), Transaction.id.desc())
            .limit(limit)
        )
    )
    rows.reverse()
    return rows


# ---------------------------------------------------------------- pipeline


def ingest_transaction(
    db: Session,
    engine: RuleEngine,
    bus: Any,
    payload: Any,
    source: str,
    actor_id: int | None = None,
) -> IngestResult:
    """Evaluate and store one transaction (Section 10). Raises DuplicateTransaction,
    pydantic.ValidationError / ValueError for invalid input."""
    settings = get_settings()
    data = _normalise(_to_payload(payload))  # step 1
    tid = data["transaction_id"]

    try:
        if _exists(db, tid):  # step 2
            raise DuplicateTransaction(tid)
        history = load_history(db, data["customer_id"], data["timestamp"], settings.HISTORY_LIMIT)

        txn = Transaction(**data, risk_score=0, risk_level=RiskLevel.LOW.value)  # step 4
        db.add(txn)
        db.flush()

        configs = load_rule_configs(db)  # step 5
        results = engine.evaluate(txn, RuleContext(history=history, session=db), configs)

        raw = compute_raw_score(results)  # step 6
        score = total_score(results)
        level = RiskLevel(risk_level(score))
        txn.risk_score = score
        txn.risk_level = level.value
        txn.evaluated_at = utcnow()

        for r in results:  # step 7
            db.add(
                RuleResultRow(
                    transaction_pk=txn.id,
                    rule_name=r.rule_name,
                    triggered=bool(r.triggered),
                    score=int(r.score or 0),
                    reason=r.reason or ("Fired" if r.triggered else "Passed"),
                    details=to_jsonable(r.details or {}),
                )
            )

        flag_id: int | None = None
        if level_gte(level, settings.FLAG_MIN_LEVEL):  # step 8
            flag = FraudFlag(
                transaction_pk=txn.id,
                risk_score=score,
                risk_level=level.value,
                status=FlagStatus.PENDING_REVIEW.value,
            )
            db.add(flag)
            db.flush()
            flag_id = flag.id

        customer_id, amount = txn.customer_id, txn.amount
        db.commit()  # step 9
    except DuplicateTransaction:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        if _exists(db, tid) or "transaction_id" in str(getattr(exc, "orig", exc)):
            raise DuplicateTransaction(tid) from exc
        raise
    except Exception:
        db.rollback()
        raise

    fired = [r.rule_name for r in results if r.triggered]
    alert = flag_id is not None and level_gte(level, settings.ALERT_MIN_LEVEL)
    if bus is not None:  # step 10
        bus.publish(
            TransactionReceived(
                transaction_id=tid, customer_id=customer_id, amount=amount, source=source
            ),
            db,
        )
        bus.publish(
            TransactionEvaluated(
                transaction_id=tid,
                score=score,
                raw_score=raw,
                level=level.value,
                fired_rules=fired,
            ),
            db,
        )
        if flag_id is not None:
            bus.publish(
                FraudFlagged(
                    flag_id=flag_id,
                    transaction_id=tid,
                    score=score,
                    level=level.value,
                    fired_rules=fired,
                ),
                db,
            )
        if alert:
            bus.publish(
                HighRiskDetected(
                    flag_id=flag_id, transaction_id=tid, score=score, level=level.value
                ),
                db,
            )

    notification_status = None
    if flag_id is not None:
        status = db.scalar(select(Notification.status).where(Notification.flag_id == flag_id))
        notification_status = str(status) if status is not None else None

    return IngestResult(
        transaction=txn,
        results=results,
        score=score,
        raw_score=raw,
        level=level.value,
        flag_id=flag_id,
        notification_status=notification_status,
    )


def _empty_summary() -> dict[str, Any]:
    return {
        "processed": 0,
        "flagged": 0,
        "alerts": 0,
        "skipped_duplicates": 0,
        "errors": [],
        "transactions": [],
    }


def ingest_batch(
    db: Session,
    engine: RuleEngine,
    bus: Any,
    payloads: list[Any],
    source: str,
    actor_id: int | None = None,
) -> dict[str, Any]:
    """Ingest many rows (sorted by timestamp); returns a BatchSummary dict. No batch event.

    Row numbers in errors are the 1-based position in `payloads`, or the CSV line
    number carried by rows from ``parse_csv``.
    """
    settings = get_settings()
    summary = _empty_summary()
    valid: list[tuple[datetime, int, int, Any]] = []

    for index, raw in enumerate(payloads or []):
        row_no = index + 1
        if isinstance(raw, dict) and raw.get(ROW_KEY) is not None:
            row_no = int(raw[ROW_KEY])
        tid = raw.get("transaction_id") if isinstance(raw, dict) else getattr(raw, "transaction_id", None)
        try:
            p = _to_payload(raw)
            data = _normalise(p)
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append(
                {"row": row_no, "transaction_id": tid, "error": format_error(exc)}
            )
            continue
        valid.append((data["timestamp"], index, row_no, p))

    valid.sort(key=lambda item: (item[0], item[1]))

    for _ts, _index, row_no, p in valid:
        tid = getattr(p, "transaction_id", None)
        try:
            result = ingest_transaction(db, engine, bus, p, source, actor_id=actor_id)
        except DuplicateTransaction:
            summary["skipped_duplicates"] += 1
            continue
        except Exception as exc:  # noqa: BLE001 - one bad row never stops the batch
            try:
                db.rollback()
            except Exception:  # noqa: BLE001
                pass
            logger.warning("Row %s (%s) failed: %s", row_no, tid, exc)
            summary["errors"].append(
                {"row": row_no, "transaction_id": tid, "error": format_error(exc)}
            )
            continue
        summary["processed"] += 1
        if result.flag_id is not None:
            summary["flagged"] += 1
            if level_gte(result.level, settings.ALERT_MIN_LEVEL):
                summary["alerts"] += 1
        summary["transactions"].append(
            {
                "transaction_id": tid,
                "customer_id": getattr(p, "customer_id", None),
                "score": result.score,
                "level": result.level,
                "flag_id": result.flag_id,
            }
        )

    summary["errors"].sort(key=lambda e: (e["row"] if isinstance(e["row"], int) else 0))
    return summary


# ---------------------------------------------------------------- CSV


def parse_csv(content: bytes) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse CSV bytes (utf-8-sig, header required, column order free, extra columns ignored).

    Returns (rows, errors). Each row is a dict of the known columns (empty cells ->
    None) plus ``_row`` = its line number in the file (header = line 1). Rows with a
    missing required value become errors ``{row, transaction_id, error}``.
    Raises ValueError when the file is not a usable CSV (API -> 400).
    """
    if isinstance(content, str):
        text = content
    else:
        try:
            text = bytes(content or b"").decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ValueError("File is not valid UTF-8 text") from exc
    if text.startswith("﻿"):
        text = text[1:]
    if not text.strip():
        raise ValueError("CSV file is empty")

    reader = csv.reader(io.StringIO(text, newline=""))
    try:
        header = next(reader)
    except (StopIteration, csv.Error) as exc:
        raise ValueError(f"Could not read CSV header: {exc}") from exc
    columns = [(h or "").strip().lower() for h in header]
    missing = [c for c in REQUIRED_COLUMNS if c not in columns]
    if missing:
        raise ValueError(f"CSV header is missing required column(s): {', '.join(missing)}")
    index = {name: columns.index(name) for name in CSV_COLUMNS if name in columns}

    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    try:
        for cells in reader:
            line_no = reader.line_num
            if not cells or all(not (c or "").strip() for c in cells):
                continue
            row: dict[str, Any] = {}
            for name, pos in index.items():
                value = cells[pos].strip() if pos < len(cells) and cells[pos] is not None else ""
                row[name] = value if value != "" else None
            empty = [c for c in REQUIRED_COLUMNS if row.get(c) is None]
            if empty:
                errors.append(
                    {
                        "row": line_no,
                        "transaction_id": row.get("transaction_id"),
                        "error": f"Missing required value(s): {', '.join(empty)}",
                    }
                )
                continue
            row[ROW_KEY] = line_no
            rows.append(row)
    except csv.Error as exc:
        raise ValueError(f"Malformed CSV near line {reader.line_num}: {exc}") from exc
    return rows, errors


def _run_csv(db, engine, bus, content: bytes, source: str, actor_id) -> dict[str, Any]:
    rows, parse_errors = parse_csv(content)
    summary = ingest_batch(db, engine, bus, rows, source, actor_id=actor_id)
    if parse_errors:
        summary["errors"] = sorted(
            parse_errors + summary["errors"],
            key=lambda e: (e["row"] if isinstance(e["row"], int) else 0),
        )
    return summary


def load_demo(
    db: Session,
    engine: RuleEngine,
    bus: Any,
    actor_id: int | None = None,
    path: str | Path | None = None,
) -> dict[str, Any]:
    """Ingest sample_data/demo_transactions.csv (duplicates skipped); publishes DemoLoaded."""
    content = Path(path or DEMO_CSV_PATH).read_bytes()
    summary = _run_csv(db, engine, bus, content, "demo", actor_id)
    if bus is not None:
        bus.publish(DemoLoaded(summary=summary, user_id=actor_id), db)
    return summary


def import_csv(
    db: Session,
    engine: RuleEngine,
    bus: Any,
    content: bytes,
    actor_id: int | None = None,
    filename: str | None = None,
) -> dict[str, Any]:
    """Ingest an uploaded CSV; publishes CsvUploaded. ValueError for an unusable file."""
    summary = _run_csv(db, engine, bus, content, "csv", actor_id)
    if bus is not None:
        bus.publish(CsvUploaded(summary=summary, user_id=actor_id, filename=filename), db)
    return summary


def reset_data(db: Session, bus: Any, actor_id: int | None = None) -> dict[str, Any]:
    """Delete transactions, rule results, flags, review actions and notifications.

    Users, rule configs and the audit log are kept. Publishes DataReset.
    """
    deleted: dict[str, int] = {}
    try:
        for key, model in (
            ("notifications", Notification),
            ("review_actions", ReviewAction),
            ("rule_results", RuleResultRow),
            ("fraud_flags", FraudFlag),
            ("transactions", Transaction),
        ):
            result = db.execute(delete(model))
            deleted[key] = int(result.rowcount or 0)
        db.commit()
    except Exception:
        db.rollback()
        raise
    ordered = {
        k: deleted[k]
        for k in ("transactions", "rule_results", "fraud_flags", "review_actions", "notifications")
    }
    if bus is not None:
        bus.publish(DataReset(user_id=actor_id, deleted=ordered), db)
    return {"deleted": ordered}


# ---------------------------------------------------------------- serialisation


def serialize_transaction(txn: Transaction) -> dict[str, Any]:
    """TransactionOut dict (docs/API_CONTRACT.md)."""
    return {
        "id": txn.id,
        "transaction_id": txn.transaction_id,
        "customer_id": txn.customer_id,
        "amount": txn.amount,
        "currency": txn.currency,
        "merchant": txn.merchant,
        "city": txn.city,
        "latitude": txn.latitude,
        "longitude": txn.longitude,
        "timestamp": _iso(txn.timestamp),
        "device_id": txn.device_id,
        "account_balance": txn.account_balance,
        "risk_score": txn.risk_score,
        "risk_level": str(txn.risk_level) if txn.risk_level is not None else None,
        "evaluated_at": _iso(txn.evaluated_at),
        "created_at": _iso(txn.created_at),
    }


def _meta(rules: Any, name: str) -> dict[str, Any]:
    try:
        if isinstance(rules, RuleEngine):
            return rules.meta(name)
        if rules is not None and hasattr(rules, "get"):
            cls = rules.get(name)
            if cls is not None:
                return rule_meta(cls)
    except Exception:  # noqa: BLE001
        pass
    return {
        "name": name,
        "display_name": name.replace("_", " ").capitalize(),
        "description": "",
    }


def serialize_result(row_or_result: Any, rules: Any = None) -> dict[str, Any]:
    """RuleResultOut dict from a rule_results row or an engine RuleResult.

    `rules` is the {name: FraudRule class} registry (or a RuleEngine) used for
    display_name / description.
    """
    name = row_or_result.rule_name
    meta = _meta(rules, name)
    return {
        "rule_name": name,
        "display_name": meta.get("display_name") or name,
        "description": meta.get("description") or "",
        "triggered": bool(row_or_result.triggered),
        "score": int(row_or_result.score or 0),
        "reason": row_or_result.reason or "",
        "details": to_jsonable(row_or_result.details or {}),
    }


def sort_results(items: list[Any]) -> list[Any]:
    """Fired first (highest score first), then passed, each by rule name."""
    return sorted(items, key=lambda r: (not r.triggered, -int(r.score or 0), r.rule_name))
