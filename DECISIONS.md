# Decisions and deviations

This file records choices made where the implementation plan was ambiguous, and any deviation from its contracts.

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Repo root | The plan's `fraud-engine/` folder is the repository root itself, so `backend/` and `frontend/` sit at the top level. | An extra nesting level adds nothing. |
| 2 | Frontend versions | React 18, react-leaflet 4 (v5 needs React 19), Vite 5. | Matches the plan's "React 18" requirement. |
| 3 | System clock | System timestamps (`created_at`, `evaluated_at`, `updated_at`, ...) are naive **server-local** time, the same clock the simulator uses. Offset timestamps on incoming transactions are still converted to UTC per Section 6.1. | The console parses naive ISO strings as local time; with naive UTC, "Flagged 5 h ago" showed for a flag created 2 minutes earlier in IST. |
| 4 | Add rules from the UI (extra) | Admins can create **condition rules** (field + operator + value, e.g. amount ≥ ₹1,00,000) from the Rules page. `POST /api/rules` writes `app/rules/custom_<id>.py` from a template and hot-reloads the registry/engine (no restart); `DELETE /api/rules/{id}` removes custom rules only; `GET /api/rules/builder/options` lists fields/operators. Only allow-listed fields/operators are accepted and all values are written as `repr()` literals, so user input never becomes code. | Keeps the "a rule is one file in app/rules/" contract and leaves the engine unchanged. |
