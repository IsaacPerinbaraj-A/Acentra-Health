"""Rule configuration endpoints (plan Section 14 "Rules", 18.1, 18.2).

GET    /api/rules               any    -> [RuleOut] sorted by name
POST   /api/rules/backtest      ADMIN  -> backtest comparison (nothing written)
GET    /api/rules/performance   any    -> reviewer outcomes per rule
PATCH  /api/rules/{name}        ADMIN  -> RuleOut (422 bad key/type, 404 unknown)
POST   /api/rules/{name}/reset  ADMIN  -> RuleOut

/backtest and /performance are declared before /{name}.
"""

from __future__ import annotations

import copy
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_bus, get_db, get_engine, get_rules
from app.database import utcnow
from app.engine.engine import effective_params, rule_meta, validate_params
from app.enums import Role
from app.events.events import RuleConfigUpdated
from app.models import RuleConfig, User
from app.schemas import BacktestIn, RulePatchIn
from app.security import get_current_user, require_roles

router = APIRouter(prefix="/api/rules", tags=["Rules"])


# ---------------------------------------------------------------- helpers


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") if value is not None else None


def module_path(cls: Any) -> str:
    """'app.rules.velocity' -> 'app/rules/velocity.py'."""
    module = getattr(cls, "__module__", None) or ""
    return module.replace(".", "/") + ".py" if module else ""


def serialize_rule(cls: Any, config: RuleConfig | None) -> dict[str, Any]:
    meta = rule_meta(cls)
    enabled = True if config is None or config.enabled is None else bool(config.enabled)
    score = meta["default_score"] if config is None or config.score is None else int(config.score)
    updated_by = None
    if config is not None and config.updater is not None:
        updated_by = config.updater.username
    return {
        "name": meta["name"],
        "display_name": meta["display_name"],
        "description": meta["description"],
        "enabled": enabled,
        "score": score,
        "params": effective_params(cls, config),
        "default_score": meta["default_score"],
        "default_params": meta["default_params"],
        "module": module_path(cls),
        "updated_at": _iso(config.updated_at) if config is not None else None,
        "updated_by": updated_by,
        "custom": getattr(cls, "__module__", "").rsplit(".", 1)[-1].startswith("custom_"),
    }


def _snapshot(cls: Any, config: RuleConfig | None) -> dict[str, Any]:
    data = serialize_rule(cls, config)
    return {"enabled": data["enabled"], "score": data["score"], "params": data["params"]}


def _get_rule_class(rules: dict, name: str) -> Any:
    cls = rules.get(name)
    if cls is None:
        raise HTTPException(status_code=404, detail=f"Unknown rule '{name}'")
    return cls


def _get_or_create_config(db: Session, cls: Any) -> RuleConfig:
    row = db.get(RuleConfig, cls.name)
    if row is None:
        meta = rule_meta(cls)
        row = RuleConfig(
            rule_name=cls.name,
            enabled=True,
            score=meta["default_score"],
            params=copy.deepcopy(meta["default_params"]),
        )
        db.add(row)
        db.flush()
    return row


# ---------------------------------------------------------------- list


@router.get("")
def list_rules(
    db: Session = Depends(get_db),
    rules: dict = Depends(get_rules),
    _user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    configs = {c.rule_name: c for c in db.scalars(select(RuleConfig)).all()}
    return [serialize_rule(rules[name], configs.get(name)) for name in sorted(rules)]


# ---------------------------------------------------------------- rule builder (add rules from the UI)


@router.get("/builder/options")
def builder_options(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    from app.services.rule_builder import OPTIONS

    return OPTIONS


@router.post("", status_code=201)
def create_rule(
    body: dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    bus=Depends(get_bus),
    rules: dict = Depends(get_rules),
    user: User = Depends(require_roles(Role.ADMIN)),
) -> dict[str, Any]:
    """Create a condition rule: writes app/rules/custom_<name>.py and hot-reloads the engine."""
    from app.services import rule_builder

    try:
        spec = rule_builder.validate_spec(body, set(rules))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    rule_builder.write_rule_file(spec)
    new_rules = rule_builder.reload_rules(request.app, db)
    if spec["name"] not in new_rules:
        rule_builder.delete_rule_file(spec["name"])
        rule_builder.reload_rules(request.app, db)
        raise HTTPException(status_code=500, detail="Rule file was written but could not be loaded")
    config = db.get(RuleConfig, spec["name"])
    if config is not None:
        config.updated_by = user.id
        config.updated_at = utcnow()
    db.commit()
    after = _snapshot(new_rules[spec["name"]], config)
    bus.publish(RuleConfigUpdated(rule_name=spec["name"], before={}, after={**after, "created": True}, user_id=user.id), db)
    return serialize_rule(new_rules[spec["name"]], db.get(RuleConfig, spec["name"]))


@router.delete("/{name}")
def delete_rule(
    name: str,
    request: Request,
    db: Session = Depends(get_db),
    bus=Depends(get_bus),
    rules: dict = Depends(get_rules),
    user: User = Depends(require_roles(Role.ADMIN)),
) -> dict[str, Any]:
    """Delete a rule created with the rule builder (built-in rules can only be disabled)."""
    from app.services import rule_builder

    cls = _get_rule_class(rules, name)
    if not rule_builder.is_custom(cls):
        raise HTTPException(status_code=400, detail="Built-in rules can't be deleted; disable them instead")
    before = _snapshot(cls, db.get(RuleConfig, name))
    rule_builder.delete_rule_file(name)
    row = db.get(RuleConfig, name)
    if row is not None:
        db.delete(row)
    rule_builder.reload_rules(request.app, db)
    db.commit()
    bus.publish(RuleConfigUpdated(rule_name=name, before=before, after={"deleted": True}, user_id=user.id), db)
    return {"deleted": name}


# ---------------------------------------------------------------- phase 8 (before /{name})


@router.post("/backtest")
def backtest(
    body: BacktestIn,
    db: Session = Depends(get_db),
    engine=Depends(get_engine),
    _user: User = Depends(require_roles(Role.ADMIN)),
) -> dict[str, Any]:
    from app.services.backtest import run_backtest

    try:
        return run_backtest(db, engine, body.overrides or {})
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc).strip("'\"")) from None


@router.get("/performance")
def performance(
    db: Session = Depends(get_db),
    rules: dict = Depends(get_rules),
    _user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    from app.services.backtest import rule_performance

    return rule_performance(db, rules)


# ---------------------------------------------------------------- edit / reset


@router.patch("/{name}")
def update_rule(
    name: str,
    body: RulePatchIn,
    db: Session = Depends(get_db),
    bus=Depends(get_bus),
    rules: dict = Depends(get_rules),
    user: User = Depends(require_roles(Role.ADMIN)),
) -> dict[str, Any]:
    cls = _get_rule_class(rules, name)
    user_id = user.id
    data = body.model_dump(exclude_unset=True)

    # ---- validate everything before touching the row
    enabled = data.get("enabled")
    if enabled is not None and not isinstance(enabled, bool):
        raise HTTPException(status_code=422, detail="'enabled' must be true or false")
    score = data.get("score")
    if score is not None:
        if isinstance(score, bool) or not isinstance(score, (int, float)):
            raise HTTPException(status_code=422, detail="'score' must be a number between 0 and 100")
        if float(score) != int(score) or not 0 <= int(score) <= 100:
            raise HTTPException(status_code=422, detail="'score' must be a whole number between 0 and 100")
        score = int(score)
    clean_params: dict[str, Any] | None = None
    if data.get("params") is not None:
        try:
            clean_params = validate_params(rule_meta(cls)["default_params"], data["params"])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None

    row = _get_or_create_config(db, cls)
    before = _snapshot(cls, row)

    if enabled is not None:
        row.enabled = enabled
    if score is not None:
        row.score = score
    if clean_params is not None:
        row.params = {**dict(row.params or {}), **clean_params}
    row.updated_by = user_id
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)

    after = _snapshot(cls, row)
    bus.publish(
        RuleConfigUpdated(rule_name=cls.name, before=before, after=after, user_id=user_id), db
    )
    return serialize_rule(cls, db.get(RuleConfig, cls.name))


@router.post("/{name}/reset")
def reset_rule(
    name: str,
    db: Session = Depends(get_db),
    bus=Depends(get_bus),
    rules: dict = Depends(get_rules),
    user: User = Depends(require_roles(Role.ADMIN)),
) -> dict[str, Any]:
    cls = _get_rule_class(rules, name)
    user_id = user.id
    meta = rule_meta(cls)
    row = _get_or_create_config(db, cls)
    before = _snapshot(cls, row)

    row.enabled = True
    row.score = meta["default_score"]
    row.params = copy.deepcopy(meta["default_params"])
    row.updated_by = user_id
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)

    after = _snapshot(cls, row)
    bus.publish(
        RuleConfigUpdated(rule_name=cls.name, before=before, after=after, user_id=user_id), db
    )
    return serialize_rule(cls, db.get(RuleConfig, cls.name))
