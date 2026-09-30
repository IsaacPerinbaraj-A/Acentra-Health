"""Command line tools (plan Section 14, CLI).

    python -m app.cli load-demo   # ingest sample_data/demo_transactions.csv
    python -m app.cli reset       # delete transactions, flags, results, reviews, notifications

Both build their own rule engine and event bus (wired with register_handlers),
create the tables, seed the demo users and rule configs, then call the same
services as the admin endpoints.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from app.config import get_settings


def _bootstrap():
    import app.models  # noqa: F401  (register tables)
    from app.database import Base, SessionLocal
    from app.database import engine as db_engine
    from app.engine.engine import RuleEngine
    from app.engine.registry import discover_rules
    from app.events.bus import EventBus
    from app.events.handlers import register_handlers
    from app.seed import seed_users, sync_rule_configs

    Base.metadata.create_all(bind=db_engine)
    rules = discover_rules()
    engine = RuleEngine(rules)
    bus = EventBus()
    register_handlers(bus)
    db = SessionLocal()
    seed_users(db, get_settings())
    sync_rule_configs(db, rules)
    db.commit()
    return db, engine, bus


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="RiskLens CLI")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("load-demo", help="Ingest the demo dataset (duplicates are skipped)")
    sub.add_parser("reset", help="Delete all transaction data (keeps users, rules, audit log)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    from app.services.ingest import load_demo, reset_data

    db, engine, bus = _bootstrap()
    try:
        if args.command == "load-demo":
            summary = load_demo(db, engine, bus)
            print(
                f"Demo loaded: processed={summary['processed']} flagged={summary['flagged']} "
                f"alerts={summary['alerts']} skipped_duplicates={summary['skipped_duplicates']} "
                f"errors={len(summary['errors'])}"
            )
            for err in summary["errors"]:
                print(f"  row {err['row']} ({err['transaction_id']}): {err['error']}")
        else:
            result = reset_data(db, bus)
            print("Data reset: " + json.dumps(result["deleted"]))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
