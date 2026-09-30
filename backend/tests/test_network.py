"""Fraud network graph (plan Sections 12 and 20)."""

from __future__ import annotations

from datetime import datetime, timedelta

from app.models import Transaction
from app.services.network import UnionFind, build_network, linked_customers

BASE = datetime(2026, 10, 1, 9, 0, 0)


def _add(db, txn_id: str, customer_id: str, device_id: str | None, minutes: int = 0) -> None:
    db.add(
        Transaction(
            transaction_id=txn_id,
            customer_id=customer_id,
            amount=1000.0,
            currency="INR",
            timestamp=BASE + timedelta(minutes=minutes),
            device_id=device_id,
            risk_score=0,
            risk_level="LOW",
        )
    )


# ---------------------------------------------------------------- demo dataset


def test_demo_has_exactly_one_ring_on_d900(db, demo_loaded):
    net = build_network(db)
    assert net["total_clusters"] == 1
    assert net["threshold"] == 3
    assert len(net["clusters"]) == 1
    cluster = net["clusters"][0]
    assert cluster["id"] == 1
    assert cluster["is_ring"] is True
    assert [c["customer_id"] for c in cluster["customers"]] == ["C201", "C202", "C203", "C204"]
    shared = [d for d in cluster["devices"] if d["is_shared"]]
    assert [d["device_id"] for d in shared] == ["D900"]
    assert shared[0]["customer_count"] == 4
    assert shared[0]["transaction_count"] == 4
    assert cluster["max_level"] == "MEDIUM"
    assert {(e["customer_id"], e["device_id"]) for e in cluster["edges"]} >= {
        ("C201", "D900"),
        ("C202", "D900"),
        ("C203", "D900"),
        ("C204", "D900"),
    }
    for c in cluster["customers"]:
        assert c["transaction_count"] >= 1
        assert c["max_level"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}


def test_demo_min_customers_5_returns_no_clusters(db, demo_loaded):
    net = build_network(db, min_customers=5)
    assert net["clusters"] == []
    assert net["total_clusters"] == 0


def test_demo_date_range_before_data_returns_nothing(db, demo_loaded):
    net = build_network(db, date_to=datetime(2000, 1, 1))
    assert net["clusters"] == []


def test_linked_customers_of_c201(db, demo_loaded):
    links = linked_customers(db, "C201")
    assert [l["customer_id"] for l in links] == ["C202", "C203", "C204"]
    assert all(l["via_device_ids"] == ["D900"] for l in links)


def test_network_endpoint_returns_ring(client, auth_headers, demo_loaded):
    resp = client.get("/api/network", headers=auth_headers("VIEWER"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_clusters"] == 1
    assert body["clusters"][0]["is_ring"] is True


# ---------------------------------------------------------------- union-find


def test_union_find_path_compression_and_size():
    uf = UnionFind()
    uf.union("a", "b")
    uf.union("c", "d")
    uf.union("b", "d")
    root = uf.find("a")
    assert all(uf.find(x) == root for x in "abcd")
    assert uf.size[root] == 4
    assert uf.find("z") == "z"


def test_two_customers_linked_through_two_devices_form_one_cluster(db):
    _add(db, "N1", "P1", "DX", 0)
    _add(db, "N2", "P1", "DY", 5)
    _add(db, "N3", "P2", "DX", 10)
    _add(db, "N4", "P2", "DY", 15)
    _add(db, "N5", "P3", "DZ", 20)  # alone on its own device
    _add(db, "N6", "P4", None, 25)  # no device: ignored
    db.flush()

    net = build_network(db)
    assert net["total_clusters"] == 1
    cluster = net["clusters"][0]
    assert [c["customer_id"] for c in cluster["customers"]] == ["P1", "P2"]
    assert sorted(d["device_id"] for d in cluster["devices"]) == ["DX", "DY"]
    assert len(cluster["edges"]) == 4
    assert cluster["is_ring"] is False  # 2 customers per device < threshold 3


def test_union_find_joins_chain_via_different_devices(db):
    # A -D1- B -D2- C: A and C never share a device but are one component
    _add(db, "M1", "A", "D1", 0)
    _add(db, "M2", "B", "D1", 5)
    _add(db, "M3", "B", "D2", 10)
    _add(db, "M4", "C", "D2", 15)
    db.flush()

    net = build_network(db)
    assert len(net["clusters"]) == 1
    assert [c["customer_id"] for c in net["clusters"][0]["customers"]] == ["A", "B", "C"]
    assert [l["customer_id"] for l in linked_customers(db, "B")] == ["A", "C"]
    assert linked_customers(db, "A") == [{"customer_id": "B", "via_device_ids": ["D1"]}]
    assert build_network(db, min_customers=4)["clusters"] == []
