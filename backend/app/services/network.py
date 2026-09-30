"""Fraud network graph (plan Section 12).

Bipartite graph: customers <-> devices. An edge joins a customer to every device
they transacted with (weight = number of transactions). Transactions without a
``device_id`` are ignored. Connected components are found with union-find
(path compression + union by size); no external graph library.

    build_network(db, min_customers=2, date_from=None, date_to=None, limit=50)
        -> {"clusters": [...], "total_clusters": n, "threshold": shared_device.min_customers}
    linked_customers(db, customer_id) -> [{"customer_id", "via_device_ids"}]
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Hashable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.enums import RiskLevel, max_level
from app.models import FraudFlag, RuleConfig, Transaction

__all__ = [
    "UnionFind",
    "build_network",
    "linked_customers",
    "shared_device_threshold",
    "apply_time_range",
    "SHARED_DEVICE_RULE",
    "DEFAULT_SHARED_THRESHOLD",
]

SHARED_DEVICE_RULE = "shared_device"
DEFAULT_SHARED_THRESHOLD = 3
_IN_CHUNK = 500  # stay well below SQLite's bound-parameter limit


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") if value is not None else None


class UnionFind:
    """Disjoint-set forest with path compression and union by size."""

    def __init__(self) -> None:
        self.parent: dict[Hashable, Hashable] = {}
        self.size: dict[Hashable, int] = {}

    def add(self, x: Hashable) -> None:
        if x not in self.parent:
            self.parent[x] = x
            self.size[x] = 1

    def find(self, x: Hashable) -> Hashable:
        self.add(x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        # path compression
        while self.parent[x] != root:
            nxt = self.parent[x]
            self.parent[x] = root
            x = nxt
        return root

    def union(self, a: Hashable, b: Hashable) -> Hashable:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return ra
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]
        return ra


def apply_time_range(stmt, date_from: datetime | None = None, date_to: datetime | None = None):
    """Filter a statement on Transaction.timestamp (inclusive bounds)."""
    if date_from is not None:
        stmt = stmt.where(Transaction.timestamp >= date_from)
    if date_to is not None:
        stmt = stmt.where(Transaction.timestamp <= date_to)
    return stmt


def shared_device_threshold(db: Session) -> int:
    """``shared_device.min_customers`` from rule_configs (default 3)."""
    try:
        row = db.get(RuleConfig, SHARED_DEVICE_RULE)
    except Exception:  # noqa: BLE001 - table missing etc.
        row = None
    params = dict(row.params or {}) if row is not None else {}
    value = params.get("min_customers", DEFAULT_SHARED_THRESHOLD)
    try:
        return int(value)
    except (TypeError, ValueError):
        return DEFAULT_SHARED_THRESHOLD


def _chunks(items: list[str], size: int = _IN_CHUNK):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _customer_stats(
    db: Session,
    customer_ids: list[str],
    date_from: datetime | None,
    date_to: datetime | None,
) -> dict[str, dict[str, Any]]:
    """{customer_id: {transaction_count, flag_count, max_level}} in the time range."""
    stats: dict[str, dict[str, Any]] = {
        cid: {"transaction_count": 0, "flag_count": 0, "levels": set()} for cid in customer_ids
    }
    for chunk in _chunks(sorted(customer_ids)):
        stmt = (
            select(
                Transaction.customer_id,
                Transaction.risk_level,
                func.count(Transaction.id),
                func.count(FraudFlag.id),
            )
            .outerjoin(FraudFlag, FraudFlag.transaction_pk == Transaction.id)
            .where(Transaction.customer_id.in_(chunk))
            .group_by(Transaction.customer_id, Transaction.risk_level)
        )
        stmt = apply_time_range(stmt, date_from, date_to)
        for cid, level, txn_count, flag_count in db.execute(stmt).all():
            entry = stats[cid]
            entry["transaction_count"] += int(txn_count or 0)
            entry["flag_count"] += int(flag_count or 0)
            if level:
                entry["levels"].add(level)
    out: dict[str, dict[str, Any]] = {}
    for cid, entry in stats.items():
        top = max_level(entry["levels"]) or RiskLevel.LOW
        out[cid] = {
            "transaction_count": entry["transaction_count"],
            "flag_count": entry["flag_count"],
            "max_level": RiskLevel(top).value,
        }
    return out


def build_network(
    db: Session,
    min_customers: int = 2,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int | None = 50,
) -> dict[str, Any]:
    """Connected customer/device components with at least `min_customers` customers.

    Sorted rings first, then by customer count (desc). ``limit`` None/<=0 = no limit.
    ``total_clusters`` counts every qualifying component (before the limit).
    """
    threshold = shared_device_threshold(db)
    min_customers = max(1, int(min_customers or 1))

    # 1) one query for the edges: (customer, device, count, last_seen)
    stmt = (
        select(
            Transaction.customer_id,
            Transaction.device_id,
            func.count(Transaction.id),
            func.max(Transaction.timestamp),
        )
        .where(Transaction.device_id.is_not(None), Transaction.device_id != "")
        .group_by(Transaction.customer_id, Transaction.device_id)
    )
    stmt = apply_time_range(stmt, date_from, date_to)
    edge_rows = db.execute(stmt).all()

    # 2) union-find over customer and device nodes
    uf = UnionFind()
    for cid, did, _count, _last in edge_rows:
        uf.union(("c", cid), ("d", did))

    # 3) group into components
    components: dict[Hashable, dict[str, Any]] = defaultdict(
        lambda: {"customers": set(), "devices": set(), "edges": []}
    )
    device_customers: dict[str, set[str]] = defaultdict(set)
    device_txns: dict[str, int] = defaultdict(int)
    for cid, did, count, last_seen in edge_rows:
        comp = components[uf.find(("c", cid))]
        comp["customers"].add(cid)
        comp["devices"].add(did)
        comp["edges"].append(
            {
                "customer_id": cid,
                "device_id": did,
                "transaction_count": int(count or 0),
                "last_seen": _iso(last_seen),
            }
        )
        device_customers[did].add(cid)
        device_txns[did] += int(count or 0)

    qualified = []
    for comp in components.values():
        if len(comp["customers"]) < min_customers:
            continue
        devices = [
            {
                "device_id": did,
                "customer_count": len(device_customers[did]),
                "transaction_count": device_txns[did],
                "is_shared": len(device_customers[did]) >= threshold,
            }
            for did in comp["devices"]
        ]
        devices.sort(key=lambda d: (-d["customer_count"], d["device_id"]))
        comp["device_list"] = devices
        comp["is_ring"] = any(d["is_shared"] for d in devices)
        qualified.append(comp)

    qualified.sort(
        key=lambda c: (not c["is_ring"], -len(c["customers"]), min(c["customers"]))
    )
    total = len(qualified)
    if limit is not None and int(limit) > 0:
        qualified = qualified[: int(limit)]

    # 4) per-customer stats only for the clusters we return
    all_customers = sorted({cid for comp in qualified for cid in comp["customers"]})
    cstats = _customer_stats(db, all_customers, date_from, date_to) if all_customers else {}

    clusters = []
    for idx, comp in enumerate(qualified, start=1):
        customers = [
            {"customer_id": cid, **cstats.get(cid, {"transaction_count": 0, "flag_count": 0, "max_level": "LOW"})}
            for cid in sorted(comp["customers"])
        ]
        top = max_level(c["max_level"] for c in customers) or RiskLevel.LOW
        clusters.append(
            {
                "id": idx,
                "is_ring": comp["is_ring"],
                "max_level": RiskLevel(top).value,
                "customers": customers,
                "devices": comp["device_list"],
                "edges": sorted(comp["edges"], key=lambda e: (e["customer_id"], e["device_id"])),
            }
        )

    return {"clusters": clusters, "total_clusters": total, "threshold": threshold}


def linked_customers(db: Session, customer_id: str) -> list[dict[str, Any]]:
    """Other customers who used any device this customer used.

    -> ``[{"customer_id", "via_device_ids": [sorted]}]`` sorted by customer id.
    """
    devices_sub = (
        select(Transaction.device_id)
        .where(
            Transaction.customer_id == customer_id,
            Transaction.device_id.is_not(None),
            Transaction.device_id != "",
        )
        .distinct()
    )
    stmt = (
        select(Transaction.customer_id, Transaction.device_id)
        .where(Transaction.device_id.in_(devices_sub), Transaction.customer_id != customer_id)
        .distinct()
    )
    links: dict[str, set[str]] = defaultdict(set)
    for cid, did in db.execute(stmt).all():
        links[cid].add(did)
    return [
        {"customer_id": cid, "via_device_ids": sorted(links[cid])} for cid in sorted(links)
    ]
