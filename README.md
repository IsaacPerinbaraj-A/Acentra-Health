# RiskLens — Fraud Rule Engine with Reviewer Console

**Explainable fraud screening.** Transactions go through a pluggable rule engine and get a 0–100 risk score and a level (LOW / MEDIUM / HIGH / CRITICAL). They are stored together with every rule result and a fraud flag, and any side effects (alerts, audit, live feed) run through an in-process event bus. Analysts triage flags in a React console ("RiskLens").

> Screenshots: _add `docs/screenshots/queue.png`, `flag-detail.png`, `network.png`, `dashboard.png` here._

---

## 1. Features

### Required (problem statement)
| # | Requirement | Where |
|---|---|---|
| 1 | Rule engine for transaction risk evaluation | `backend/app/engine/` |
| 2 | Velocity, unusual amount, impossible location rules | `backend/app/rules/velocity.py`, `unusual_amount.py`, `impossible_travel.py` |
| 3 | New rules addable without modifying the core engine | auto-discovery in `engine/registry.py` (see §9) |
| 4 | Persist transactions and fraud flags | SQLAlchemy models in `backend/app/models.py` |
| 5 | React-based reviewer console | `frontend/` |
| 6 | Display flagged transactions | Flag queue (`/flags`) |
| 7 | Mark reviewed or cleared | Flag detail decision card + `POST /api/flags/{id}/status` |
| 8 | SES email or SNS notification above the high-risk threshold | `services/notifier.py` via the `HighRiskDetected` event |

### Extras
- Six rules in total: the three above plus **balance drain**, **high-risk merchant watchlist** and **shared device (fraud ring)**
- Event-driven side effects (alerts, audit log, live event feed) through a synchronous in-process event bus
- Graph-based fraud ring detection: a customer–device graph with union-find clusters, drawn on the **Network** page
- Role-based access control (Admin / Reviewer / Viewer) with JWT login
- Explainable score breakdown and plain-English reasons, impossible-travel map, fraud ring graph, amount and balance evidence
- Dashboard with charts, customer profile with linked customers
- Rules management (enable/disable, points, parameters) stored in the DB; **backtest ("what-if")** and **reviewer clear rate** per rule
- `CONFIRMED_FRAUD` status, reviewer notes, full review history, Undo
- Audit log and alert history pages; alert de-duplication
- CSV upload, one-click demo data, scenario simulator with a live event feed
- Light and dark themes, command palette (Ctrl/Cmd + K), keyboard-driven triage

### Not implemented (future work)
PostgreSQL, ML scoring, graph ML, rings via IP/card/payee (only devices are used), real payment-network integration, external brokers (Kafka/RabbitMQ/Redis), Docker, multi-tenancy, SSO/MFA, password reset, email templates, Alembic migrations, WebSockets, mobile layout below 1024 px, i18n, case assignment.

---

## 2. Architecture

```
  API (X-API-Key / admin)   CSV upload   Demo loader   Simulator
            \                   |            |            /
             v                  v            v           v
        ┌──────────────────── services/ingest.py ───────────────────┐
        │ 1 normalise + validate   2 duplicate check (409)          │
        │ 3 load customer history (earlier timestamps only)         │
        │ 4 insert + flush         5 RuleEngine.evaluate()  ◄───────┼── engine/registry.py
        │ 6 score + level          7 rule_results (every rule)      │   auto-discovers
        │ 8 fraud_flag if >= MEDIUM                                 │   app/rules/*.py
        │ 9 COMMIT (one DB transaction: never half-saved)           │
        └──────────────┬────────────────────────────────────────────┘
                       │ 10 publish events (after commit)
                       v
              ┌──────── EventBus (in-process, synchronous) ────────┐
              │ TransactionReceived · TransactionEvaluated         │
              │ FraudFlagged · HighRiskDetected · FlagStatusChanged│
              │ RuleConfigUpdated · UserLoggedIn · DemoLoaded ...  │
              └───┬──────────────────┬─────────────────────┬───────┘
                  v                  v                     v
        notify_on_high_risk     audit_handler          live feed (deque)
        log / SNS / SES         audit_logs table       GET /api/events/recent
        -> NotificationProcessed

  services/network.py: customer–device bipartite graph -> union-find clusters
      -> shared_device rule (fires at >= 3 customers per device) + Network page

  SQLite (SQLAlchemy 2)  <──  FastAPI (/api/*, /docs)  <──  React console (Vite, :5173, proxy /api)
```

The core write (transaction, rule results, flag) is one atomic DB transaction. Everything that happens *because of* it (alerts, audit, feed) is an event subscriber, so an AWS failure can never lose a transaction or a flag.

---

## 3. Setup

Requirements: Python 3.11+, Node 18+.

### Backend — Windows
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env
uvicorn app.main:app --reload
```

### Backend — macOS / Linux
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload
```

The API runs on http://localhost:8000 and interactive docs are at http://localhost:8000/docs. On startup it creates `fraud.db`, the three demo users and one `rule_configs` row per discovered rule.

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to `http://localhost:8000`.

### CLI
```bash
python -m app.cli load-demo
python -m app.cli reset
```

Run these from `backend/`. They call the same services as the admin endpoints.

---

## 4. Demo walkthrough (presenter script)

1. Sign in as **admin**, open **Data & simulator** and click **Load demo** (32 transactions, 9 flags, 2 alerts).
2. **Flag queue**: 9 flags; T020 (CRITICAL 100) first, T016 (HIGH 50) second, then seven MEDIUM flags.
3. Open **T020**. Four rules fired (unusual amount 30×, impossible travel Mumbai → Delhi 1,148 km in 40 min, watchlist merchant, 92 % of balance). The score breakdown shows "Raw score 125, capped at 100", with a travel map, amount and balance evidence, and the alert card shows *Logged*.
4. Open **T031**, where the shared-device rule fired, and follow the fraud-ring graph to the **Network** page: one ring on device D900 with C201–C204.
5. Sign in as **reviewer**, open T021 and **Clear** it with a note (the Undo toast appears). It leaves the Needs-review tab, and the activity timeline shows the action.
6. Sign in as **viewer**: the decision card is read-only.
7. Back as admin, open **Data & simulator** and run **Account takeover** and **Fraud ring**, and watch the events stream into the live feed. The Network page now shows two rings.
8. On **Rules**, disable *Impossible travel* and run the impossible-travel scenario: the result is LOW. Re-enable it and the result is HIGH. Set *unusual amount multiplier* = 2.0 and click **Test changes**: the backtest lists T004 as newly flagged and writes nothing.
9. **Audit log** shows every admin action; **Alerts** shows the two LOGGED alerts and a test alert.

---

## 5. Demo accounts

| Username | Password | Role |
|---|---|---|
| admin | admin123 | ADMIN |
| reviewer | reviewer123 | REVIEWER |
| viewer | viewer123 | VIEWER |

> ⚠️ **Demo credentials only.** They are seeded when the users table is empty (`SEED_*_PASSWORD` in `.env`). Change them and `JWT_SECRET` / `INGEST_API_KEY` in any shared environment.

Permissions: all roles can view the dashboard, flags, transactions, customers, network and rules. Reviewers and admins can change flag status. Only admins can edit rules, run backtests, view alerts, the audit log and the event feed, upload CSVs, load or reset demo data, and run the simulator. Ingestion accepts either `X-API-Key` or an admin token.

---

## 6. Rules and scoring

| Score | Level | Flag created | Alert sent |
|---|---|---|---|
| 0–24 | LOW | No | No |
| 25–49 | MEDIUM | Yes | No |
| 50–74 | HIGH | Yes | Yes |
| 75–100 | CRITICAL | Yes | Yes |

Total score = sum of fired rule points, capped at 100 (the raw sum is shown in the breakdown). `FLAG_MIN_LEVEL` and `ALERT_MIN_LEVEL` in `.env` move the thresholds.

| Rule | Points | Default params | Fires when |
|---|---|---|---|
| `velocity` — Transaction velocity | 30 | `window_minutes=10, max_transactions=5` | ≥ 5 transactions (incl. this one) in the last 10 min |
| `unusual_amount` — Unusual transaction amount | 30 | `multiplier=3.0, min_history=3, lookback=30, new_customer_limit=50000` | amount ≥ 3× the customer's average, or ≥ ₹50,000 for customers with < 3 transactions |
| `impossible_travel` — Impossible travel | 50 | `min_distance_km=50, max_speed_kmh=900, min_elapsed_minutes=1` | ≥ 50 km from the previous payment at an implied speed > 900 km/h |
| `balance_drain` — Balance drain | 25 | `max_ratio=0.8` | a single payment uses ≥ 80 % of the balance before it |
| `high_risk_merchant` — High-risk merchant watchlist | 20 | `merchants=["CryptoXchange","QuickGiftCards"]` | merchant is on the watchlist (case/space-insensitive) |
| `shared_device` — Shared device (fraud ring) | 40 | `min_customers=3, lookback_days=30` | ≥ 3 distinct customers used this device in the last 30 days |

Rules decide *whether* they fire and *why*. The engine assigns the points from the `rule_configs` table, so admins can change points and parameters on the Rules page without code changes. Edits affect new transactions only.

---

## 7. Events and handlers

| Event | Published by |
|---|---|
| `TransactionReceived`, `TransactionEvaluated` | ingest (after commit) |
| `FraudFlagged` | ingest (flag created) |
| `HighRiskDetected` | ingest (level ≥ `ALERT_MIN_LEVEL`) |
| `NotificationProcessed` | notifier handler |
| `FlagStatusChanged` | review service |
| `RuleConfigUpdated` | rules API |
| `UserLoggedIn` | auth API |
| `DemoLoaded`, `CsvUploaded`, `DataReset`, `SimulationRun`, `TestAlertSent` | admin / transactions / notifications APIs |

Handlers (`backend/app/events/handlers.py`): `notify_on_high_risk` (HighRiskDetected → SNS/SES/log, then NotificationProcessed) and `audit_handler` (every event except the two noisy transaction events → `audit_logs`). The bus also keeps the last `EVENT_FEED_SIZE` events in memory for the live feed. A failing handler is logged and recorded in the feed, and it never affects other handlers or the caller.

**Adding a side effect** (e.g. Slack) is a matter of writing a handler and subscribing it in `register_handlers`. The pipeline doesn't change:

```python
def slack_on_ring(event, db):
    ...  # post a message
bus.subscribe(FraudFlagged, slack_on_ring)
```

---

## 8. Adding a new rule (no engine changes)

**From the console (no code, no restart):** on **Rules**, admins click **Add rule** and enter a name, a condition (field such as amount, balance, merchant, city, device or customer; an operator such as ≥, =, contains or "is one of"; and a value) and the points. The backend writes `backend/app/rules/custom_<id>.py`, then re-discovers the rules and reloads the engine on the spot. The rule runs on the next transaction, and its parameters stay editable on its card. Custom rules can be deleted from their card; built-in rules can only be disabled.

**In code:** create one file in `backend/app/rules/`, for example `new_device.py`:

```python
# app/rules/new_device.py
from app.engine.base import FraudRule, RuleResult

class NewDeviceRule(FraudRule):
    name = "new_device"
    display_name = "New device"
    description = "Fires when a customer with history uses a device never seen before."
    default_score = 20
    default_params = {"min_history": 3}

    def evaluate(self, txn, ctx, params):
        if len(ctx.history) < params["min_history"] or not txn.device_id:
            return RuleResult(self.name, False, "Passed: not enough history or no device id")
        seen = {t.device_id for t in ctx.history if t.device_id}
        if txn.device_id in seen:
            return RuleResult(self.name, False, f"Passed: device {txn.device_id} seen before")
        return RuleResult(self.name, True, f"New device {txn.device_id} (known: {len(seen)})",
                          {"device_id": txn.device_id, "known_devices": sorted(seen)})
```

Restart the backend. The rule appears in `GET /api/rules` and on the Rules page (the console gives unknown rules a fallback color and icon automatically), and it runs on new transactions. `tests/test_registry.py` proves that discovery needs no engine change.

---

## 9. AWS alerts (SNS / SES)

Default `NOTIFY_MODE=log` prints alerts to the server log (status `LOGGED`). Credentials come from the standard AWS chain (`aws configure`, env vars, `AWS_PROFILE`). Never commit them.

**SNS**
1. Create a *Standard* topic in the SNS console.
2. Create an *Email* subscription and confirm the link sent to that address.
3. Set `NOTIFY_MODE=sns`, `SNS_TOPIC_ARN=arn:aws:sns:...`, `AWS_REGION=ap-south-1` in `backend/.env`.

**SES**
1. Verify the sender identity (and, in sandbox mode, each recipient).
2. Set `NOTIFY_MODE=ses`, `SES_SENDER=alerts@example.com`, `SES_RECIPIENTS=a@example.com,b@example.com`, `AWS_REGION`.

The IAM user only needs `sns:Publish` on that topic, or `ses:SendEmail`. Calls use short timeouts and a single attempt. Any failure is stored as `FAILED` with the error and never breaks ingestion. There is one alert per flag (de-duplicated). Use **Alerts → Send test alert** to check the channel.

---

## 10. API examples

```bash
curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"admin123\"}"
```

```bash
curl -s -X POST http://localhost:8000/api/transactions -H "X-API-Key: dev-ingest-key" -H "Content-Type: application/json" -d "{\"transaction_id\":\"X1\",\"customer_id\":\"C900\",\"amount\":75000,\"timestamp\":\"2026-10-01T12:00:00\",\"city\":\"Pune\",\"latitude\":18.52,\"longitude\":73.85,\"device_id\":\"DX\",\"account_balance\":80000}"
```

```bash
curl -s "http://localhost:8000/api/flags?status=PENDING_REVIEW&sort=priority" -H "Authorization: Bearer <token>"
```

```bash
curl -s -X POST http://localhost:8000/api/flags/1/status -H "Authorization: Bearer <reviewer token>" -H "Content-Type: application/json" -d "{\"status\":\"CLEARED\",\"note\":\"Customer confirmed by phone\"}"
```

```bash
curl -s "http://localhost:8000/api/network?min_customers=2" -H "Authorization: Bearer <token>"
```

The full reference is at http://localhost:8000/docs, and the response shapes are in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

---

## 11. Tests

```bash
cd backend
pytest -q
```

The tests cover geo, every rule (fires / passes / edge cases), scoring boundaries, rule auto-discovery, the event bus, the ingest pipeline, **exact reproduction of the demo dataset results**, notifications (SNS mocked with moto), the network graph, RBAC, the simulator and backtesting.

---

## 12. Limitations

- Rule-based, not machine learning; thresholds are illustrative and not tuned on real data. No claims of detection accuracy.
- The fraud-ring rule only uses shared devices (not IPs, cards or payees).
- The JWT is stored in `localStorage` (acceptable for a demo; use httpOnly cookies in production).
- SQLite only (PostgreSQL is a `DATABASE_URL` change plus the `psycopg` driver — future work).
- The event bus is single-process and in-memory: the live feed is lost on restart (the audit log persists).
- Not designed for high throughput.

See [`DECISIONS.md`](DECISIONS.md) for design decisions and [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) for the API response shapes.
