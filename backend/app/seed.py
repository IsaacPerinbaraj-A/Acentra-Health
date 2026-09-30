"""Startup seeding: demo users and rule config sync (plan Sections 7.3 and 13)."""

from __future__ import annotations

import copy
import logging
from collections.abc import Mapping

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.enums import Role
from app.models import RuleConfig, User
from app.security import hash_password

logger = logging.getLogger(__name__)

__all__ = ["seed_users", "sync_rule_configs", "load_rule_configs", "DEMO_USERNAMES"]

# Role -> seeded username (demo credentials only).
DEMO_USERNAMES: dict[Role, str] = {
    Role.ADMIN: "admin",
    Role.REVIEWER: "reviewer",
    Role.VIEWER: "viewer",
}


def seed_users(db: Session, settings: Settings | None = None, rounds: int = 12) -> int:
    """Create admin / reviewer / viewer if the users table is empty. Returns users created."""
    settings = settings or get_settings()
    if db.scalar(select(func.count(User.id))):
        return 0
    passwords = {
        Role.ADMIN: settings.SEED_ADMIN_PASSWORD,
        Role.REVIEWER: settings.SEED_REVIEWER_PASSWORD,
        Role.VIEWER: settings.SEED_VIEWER_PASSWORD,
    }
    for role, username in DEMO_USERNAMES.items():
        db.add(
            User(
                username=username,
                password_hash=hash_password(passwords[role], rounds=rounds),
                role=role.value,
            )
        )
    db.commit()
    logger.info("Seeded demo users: %s", ", ".join(DEMO_USERNAMES.values()))
    return len(DEMO_USERNAMES)


def sync_rule_configs(db: Session, rules: Mapping[str, type]) -> list[str]:
    """Insert a rule_configs row for every discovered rule that has none.

    New rows: enabled=True, score=default_score, params=default_params.
    Existing rows are left alone. Returns the names inserted.
    """
    existing = set(db.scalars(select(RuleConfig.rule_name)))
    inserted: list[str] = []
    for name, rule in sorted(rules.items()):
        if name in existing:
            continue
        db.add(
            RuleConfig(
                rule_name=name,
                enabled=True,
                score=int(rule.default_score),
                params=copy.deepcopy(dict(rule.default_params or {})),
            )
        )
        inserted.append(name)
    if inserted:
        db.commit()
        logger.info("Created rule configs for: %s", ", ".join(inserted))
    return inserted


def load_rule_configs(db: Session) -> dict[str, RuleConfig]:
    """All rule_configs rows as {rule_name: RuleConfig} (the engine's `configs` argument)."""
    return {row.rule_name: row for row in db.scalars(select(RuleConfig))}
