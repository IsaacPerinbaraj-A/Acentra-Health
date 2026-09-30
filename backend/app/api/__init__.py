"""HTTP routers. Every module defines `router = APIRouter(prefix="/api/<area>")`; main.py includes them all."""

# Router modules included by app.main, in this order.
ROUTER_MODULES: tuple[str, ...] = (
    "auth",
    "transactions",
    "flags",
    "customers",
    "network",
    "rules",
    "notifications",
    "audit",
    "events",
    "stats",
    "admin",
)
