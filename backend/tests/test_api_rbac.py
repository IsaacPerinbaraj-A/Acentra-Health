"""RBAC and auth coverage for the API (plan Section 20 - test_api_rbac.py).

Uses the conftest fixtures: client, db, auth_headers(role), api_key_headers,
make_txn_payload(**overrides), demo_loaded.
"""

from __future__ import annotations

from sqlalchemy import func, select

from app.models import AuditLog, FraudFlag, ReviewAction


def _first_pending_flag_id(db) -> int:
    db.expire_all()
    flag_id = db.scalar(
        select(FraudFlag.id).where(FraudFlag.status == "PENDING_REVIEW").order_by(FraudFlag.id)
    )
    assert flag_id is not None, "demo data should create pending flags"
    return flag_id


# ---------------------------------------------------------------- authentication


def test_requests_without_token_are_401(client):
    for path in ("/api/auth/me", "/api/flags", "/api/rules", "/api/customers/C105"):
        resp = client.get(path)
        assert resp.status_code == 401, path


def test_invalid_token_is_401(client):
    resp = client.get("/api/flags", headers={"Authorization": "Bearer not-a-jwt"})
    assert resp.status_code == 401


def test_login_bad_credentials_401(client):
    resp = client.post("/api/auth/login", json={"username": "nobody", "password": "wrong-password"})
    assert resp.status_code == 401


def test_me_returns_role(client, auth_headers):
    for role in ("VIEWER", "REVIEWER", "ADMIN"):
        resp = client.get("/api/auth/me", headers=auth_headers(role))
        assert resp.status_code == 200
        body = resp.json()
        assert body["role"] == role
        assert {"id", "username", "role"} <= set(body)


# ---------------------------------------------------------------- flags


def test_viewer_can_read_flags(client, auth_headers, demo_loaded, db):
    headers = auth_headers("VIEWER")
    resp = client.get("/api/flags", headers=headers)
    assert resp.status_code == 200
    page = resp.json()
    assert page["total"] == 9
    assert page["page"] == 1
    first = page["items"][0]
    assert first["status"] == "PENDING_REVIEW"
    assert first["risk_level"] == "CRITICAL"
    assert first["transaction"]["transaction_id"] == "T020"
    assert first["waiting_minutes"] is not None
    assert len(first["fired_rules"]) == len(first["fired_rule_names"]) == 4

    detail = client.get(f"/api/flags/{first['id']}", headers=headers)
    assert detail.status_code == 200
    body = detail.json()
    assert body["score"] == 100 and body["raw_score"] == 125
    assert body["results"][0]["triggered"] is True
    assert body["queue_position"] == 1 and body["queue_total"] == 9
    assert body["prev_id"] is None and body["next_id"] is not None

    assert client.get("/api/flags/999999", headers=headers).status_code == 404


def test_viewer_cannot_change_flag_status(client, auth_headers, demo_loaded, db):
    flag_id = _first_pending_flag_id(db)
    resp = client.post(
        f"/api/flags/{flag_id}/status", json={"status": "CLEARED"}, headers=auth_headers("VIEWER")
    )
    assert resp.status_code == 403
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(ReviewAction)) == 0


def test_reviewer_changes_status_creates_review_action_and_audit(client, auth_headers, demo_loaded, db):
    flag_id = _first_pending_flag_id(db)
    headers = auth_headers("REVIEWER")
    resp = client.post(
        f"/api/flags/{flag_id}/status",
        json={"status": "CLEARED", "note": "Customer confirmed the payment"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["flag"]["status"] == "CLEARED"
    assert body["flag"]["last_reviewed_by"] is not None
    assert body["flag"]["waiting_minutes"] is None
    assert body["queue_position"] is None
    assert len(body["review_actions"]) == 1
    action = body["review_actions"][0]
    assert action["from_status"] == "PENDING_REVIEW"
    assert action["to_status"] == "CLEARED"
    assert action["note"] == "Customer confirmed the payment"
    assert action["username"]

    db.expire_all()
    assert db.scalar(select(func.count()).select_from(ReviewAction)) == 1
    audit_count = db.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.action == "FlagStatusChanged")
    )
    assert audit_count == 1

    # Same status again -> 400
    again = client.post(f"/api/flags/{flag_id}/status", json={"status": "CLEARED"}, headers=headers)
    assert again.status_code == 400

    # Reopen is allowed and recorded
    reopen = client.post(f"/api/flags/{flag_id}/status", json={"status": "PENDING_REVIEW"}, headers=headers)
    assert reopen.status_code == 200
    assert len(reopen.json()["review_actions"]) == 2


def test_admin_can_change_status_and_invalid_status_is_422(client, auth_headers, demo_loaded, db):
    flag_id = _first_pending_flag_id(db)
    headers = auth_headers("ADMIN")
    ok = client.post(f"/api/flags/{flag_id}/status", json={"status": "CONFIRMED_FRAUD"}, headers=headers)
    assert ok.status_code == 200
    bad = client.post(f"/api/flags/{flag_id}/status", json={"status": "NOPE"}, headers=headers)
    assert bad.status_code == 422


# ---------------------------------------------------------------- rules


def test_viewer_and_reviewer_cannot_edit_rules(client, auth_headers):
    for role in ("VIEWER", "REVIEWER"):
        resp = client.patch("/api/rules/velocity", json={"score": 35}, headers=auth_headers(role))
        assert resp.status_code == 403, role


def test_admin_can_edit_rule(client, auth_headers):
    resp = client.patch("/api/rules/velocity", json={"score": 35}, headers=auth_headers("ADMIN"))
    assert resp.status_code == 200, resp.text
    assert resp.json()["score"] == 35
    listed = client.get("/api/rules", headers=auth_headers("VIEWER")).json()
    velocity = next(r for r in listed if r["name"] == "velocity")
    assert velocity["score"] == 35


def test_invalid_rule_param_key_is_422(client, auth_headers):
    resp = client.patch(
        "/api/rules/velocity", json={"params": {"not_a_param": 1}}, headers=auth_headers("ADMIN")
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------- events feed


def test_events_recent_is_admin_only(client, auth_headers):
    assert client.get("/api/events/recent").status_code == 401
    assert client.get("/api/events/recent", headers=auth_headers("VIEWER")).status_code == 403
    assert client.get("/api/events/recent", headers=auth_headers("REVIEWER")).status_code == 403
    resp = client.get("/api/events/recent", headers=auth_headers("ADMIN"))
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ---------------------------------------------------------------- ingestion auth


def test_api_key_ingestion_works(client, api_key_headers, make_txn_payload):
    payload = make_txn_payload(transaction_id="RBAC-KEY-1")
    resp = client.post("/api/transactions", json=payload, headers=api_key_headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["transaction"]["transaction_id"] == "RBAC-KEY-1"


def test_wrong_api_key_is_401(client, make_txn_payload):
    payload = make_txn_payload(transaction_id="RBAC-KEY-2")
    resp = client.post("/api/transactions", json=payload, headers={"X-API-Key": "definitely-wrong"})
    assert resp.status_code == 401


def test_ingestion_requires_admin_token(client, auth_headers, make_txn_payload):
    payload = make_txn_payload(transaction_id="RBAC-KEY-3")
    assert client.post("/api/transactions", json=payload).status_code == 401
    assert (
        client.post("/api/transactions", json=payload, headers=auth_headers("REVIEWER")).status_code == 403
    )
    resp = client.post("/api/transactions", json=payload, headers=auth_headers("ADMIN"))
    assert resp.status_code == 201, resp.text
