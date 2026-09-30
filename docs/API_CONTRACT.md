# API contract (source of truth for backend routers and frontend pages)

All routes under `/api`. JSON. Errors: `{"detail": ...}` (401 no/invalid token, 403 wrong role, 404, 409 duplicate, 413 file too large, 422 validation). Datetimes are naive ISO strings (`2026-10-01T09:00:00`). Pagination envelope: `{"items": [...], "total": int, "page": int, "page_size": int}` (query `page` default 1, `page_size` default 25, max 100). `from`/`to` query params filter by transaction timestamp. Repeatable params are sent as `?level=HIGH&level=CRITICAL`.

## Shared objects

- **TransactionOut**: `{id, transaction_id, customer_id, amount, currency, merchant, city, latitude, longitude, timestamp, device_id, account_balance, risk_score, risk_level, evaluated_at, created_at}`
- **TransactionListItem** = TransactionOut + `{flag_id: int|null, flag_status: str|null, fired_rules: [rule_name]}`
- **RuleResultOut**: `{rule_name, display_name, description, triggered, score, reason, details}`
- **BatchSummary**: `{processed, flagged, alerts, skipped_duplicates, errors: [{row, transaction_id, error}], transactions: [{transaction_id, customer_id, score, level, flag_id}]}`
- **NotificationOut**: `{id, flag_id, transaction_id, channel, target, status, subject, message, error, created_at}`
- **RuleOut**: `{name, display_name, description, enabled, score, params, default_score, default_params, module, updated_at, updated_by}` (`params` = effective params; `module` e.g. `app/rules/velocity.py`; `updated_by` = username or null)

## Auth
| Method | Path | Roles | Body → Response |
|---|---|---|---|
| POST | /api/auth/login | public | `{username, password}` → `{access_token, token_type: "bearer", user: {id, username, role}}` |
| GET | /api/auth/me | any | → `{id, username, role}` |

## Transactions
| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | /api/transactions | `X-API-Key` or ADMIN | TransactionIn → **201** `{transaction: TransactionOut, score, raw_score, level, results: [RuleResultOut], flag_id, notification_status}` |
| POST | /api/transactions/bulk | `X-API-Key` or ADMIN | `[TransactionIn]` (max 1000) → BatchSummary |
| POST | /api/transactions/upload | ADMIN | multipart field `file` → BatchSummary |
| GET | /api/transactions | any | query `q, level*, customer_id, device_id, from, to, page, page_size` → Page[TransactionListItem], newest first |
| GET | /api/transactions/{transaction_id} | any | → `{transaction: TransactionOut, results: [RuleResultOut], flag_id, flag_status}` |

TransactionIn: `{transaction_id, customer_id, amount, timestamp, currency?="INR", merchant?, city?, latitude?, longitude?, device_id?, account_balance?}`

## Flags
`GET /api/flags` (any) — query `status*, level*, rule, q, from, to, sort (priority|score|newest|oldest|amount), page, page_size` → Page of:
```json
{"id": 5, "status": "PENDING_REVIEW", "risk_score": 100, "risk_level": "CRITICAL",
 "created_at": "...", "updated_at": "...", "waiting_minutes": 12,
 "transaction": {"transaction_id": "T020", "customer_id": "C105", "amount": 60000, "currency": "INR",
                 "merchant": "QuickGiftCards", "city": "Delhi", "timestamp": "2026-10-01T09:00:00"},
 "fired_rules": ["Impossible travel", "Unusual transaction amount", "Balance drain", "High-risk merchant watchlist"],
 "fired_rule_names": ["impossible_travel", "unusual_amount", "balance_drain", "high_risk_merchant"]}
```
`waiting_minutes` is null unless PENDING_REVIEW.

`GET /api/flags/{id}` (any) and `POST /api/flags/{id}/status` (REVIEWER, ADMIN; body `{status, note?}`; 400 if unchanged) → FlagDetail:
```json
{"flag": {"id": 5, "status": "PENDING_REVIEW", "risk_score": 100, "risk_level": "CRITICAL", "created_at": "...",
          "updated_at": "...", "last_reviewed_by": null, "last_reviewed_by_username": null, "last_reviewed_at": null,
          "waiting_minutes": 12},
 "transaction": TransactionOut,
 "score": 100, "raw_score": 125, "level": "CRITICAL",
 "results": [RuleResultOut, "... fired first, then passed"],
 "customer_summary": {"customer_id": "C105", "transaction_count": 4, "total_amount": 66000, "average_amount": 16500,
                      "usual_city": "Mumbai", "cities": [{"city": "Mumbai", "count": 3}],
                      "linked_customers": [{"customer_id": "C202", "via_device_ids": ["D900"]}]},
 "recent_history": [TransactionOut + {"flag_id": null}, "... last 10 prior txns, newest first"],
 "review_actions": [{"id": 1, "from_status": "PENDING_REVIEW", "to_status": "CLEARED", "note": "...", "created_at": "...", "user_id": 2, "username": "reviewer"}],
 "notification": NotificationOut | null,
 "prev_id": null, "next_id": 7, "queue_position": 1, "queue_total": 9}
```
`prev_id/next_id/queue_position/queue_total` refer to the default pending queue (status PENDING_REVIEW, priority order); position null if this flag isn't pending.

Rule result `details` keys are exactly as in plan Section 8 (e.g. impossible_travel: `previous_transaction_id, previous_city, previous_latitude, previous_longitude, previous_timestamp, current_city, current_latitude, current_longitude, distance_km, elapsed_minutes, speed_kmh, max_speed_kmh`; unusual_amount: `mode, amount, average, ratio, history_count, multiplier, new_customer_limit`; balance_drain: `amount, account_balance, ratio, max_ratio`; shared_device: `device_id, customer_count, customer_ids, lookback_days, threshold`; velocity: `count, window_minutes, threshold, transaction_ids`; high_risk_merchant: `merchant, watchlist_size`).

## Customers and network
`GET /api/customers/{customer_id}` (any; 404 if none) →
`{customer_id, transaction_count, total_amount, average_amount, first_seen, last_seen, latest_balance, cities: [{city, count}], devices: [{device_id, count, customer_count}], linked_customers: [{customer_id, via_device_ids}], flags_by_status: {PENDING_REVIEW, REVIEWED, CLEARED, CONFIRMED_FRAUD}, flags_by_level: {MEDIUM, HIGH, CRITICAL}, transactions: [TransactionListItem] (latest 100, newest first)}`

`GET /api/network` (any; `min_customers` default 2, `from`, `to`) →
```json
{"clusters": [{"id": 1, "is_ring": true, "max_level": "MEDIUM",
   "customers": [{"customer_id": "C201", "transaction_count": 1, "flag_count": 0, "max_level": "LOW"}],
   "devices": [{"device_id": "D900", "customer_count": 4, "transaction_count": 4, "is_shared": true}],
   "edges": [{"customer_id": "C201", "device_id": "D900", "transaction_count": 1, "last_seen": "2026-10-01T10:00:00"}]}],
 "total_clusters": 1, "threshold": 3}
```

## Stats and events
`GET /api/stats` (any; `from`, `to`) →
`{total_transactions, total_flags, pending_review, alerts_sent, fraud_rings, flags_by_level: {MEDIUM, HIGH, CRITICAL}, flags_by_status: {PENDING_REVIEW, REVIEWED, CLEARED, CONFIRMED_FRAUD}, rule_fire_counts: [{rule_name, display_name, count}], flags_over_time: [{bucket, MEDIUM, HIGH, CRITICAL}], bucket: "hour"|"day"}`
After demo load: 32, 9, 9, 2, 1, {7,1,1}.

`GET /api/events/recent?limit=50` (ADMIN) → `[{name, occurred_at, payload, handler_errors: [{handler, error}]}]` newest first.

## Rules
| Method | Path | Roles | Response |
|---|---|---|---|
| GET | /api/rules | any | `[RuleOut]` sorted by name |
| PATCH | /api/rules/{name} | ADMIN | body any of `{enabled, score, params}` → RuleOut (422 bad key/type, 404 unknown) |
| POST | /api/rules/{name}/reset | ADMIN | → RuleOut |
| POST | /api/rules/backtest | ADMIN | `{overrides: {rule_name: {enabled?, score?, params?}}}` → `{current: {flagged, by_level: {MEDIUM, HIGH, CRITICAL}}, simulated: {...}, newly_flagged: [transaction_id], no_longer_flagged: [transaction_id]}` |
| GET | /api/rules/performance | any | `[{rule_name, display_name, fired_on_flags, pending, reviewed, cleared, confirmed_fraud, clear_rate}]` (clear_rate null when no decisions) |

## Notifications, audit, admin, health
| Method | Path | Roles | Response |
|---|---|---|---|
| GET | /api/notifications | ADMIN | query `status, page, page_size` → Page[NotificationOut], newest first |
| POST | /api/notifications/test | ADMIN | → NotificationOut (flag_id null) |
| GET | /api/audit | ADMIN | query `action, username, page, page_size` → Page of `{id, user_id, username, action, entity_type, entity_id, details, created_at}` newest first |
| POST | /api/admin/demo/load | ADMIN | → BatchSummary |
| POST | /api/admin/reset | ADMIN | → `{deleted: {transactions, rule_results, fraud_flags, review_actions, notifications}}` |
| GET | /api/admin/scenarios | ADMIN | → `[{key, name, description, expected_level}]` |
| POST | /api/admin/simulate | ADMIN | `{scenario}` → `{scenario, customer_ids, transactions: [{transaction_id, customer_id, score, level, flag_id}]}` (422 unknown) |
| GET | /api/health | public | → `{status: "ok", notify_mode, rules_loaded: [names], event_handlers: {event: count}}` |
