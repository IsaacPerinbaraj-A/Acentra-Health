"""Unit tests for the six fraud rules (plan Section 8).

Pure tests: transactions are plain dataclasses, history is a list. Only the
shared_device tests use a throwaway in-memory SQLite session.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.engine.base import RuleContext, RuleResult
from app.rules.balance_drain import BalanceDrainRule
from app.rules.high_risk_merchant import HighRiskMerchantRule
from app.rules.impossible_travel import ImpossibleTravelRule
from app.rules.shared_device import SharedDeviceRule
from app.rules.unusual_amount import UnusualAmountRule
from app.rules.velocity import VelocityRule

T0 = datetime(2026, 10, 1, 12, 0, 0)

MUMBAI = ("Mumbai", 19.0760, 72.8777)
DELHI = ("Delhi", 28.6139, 77.2090)
CHENNAI = ("Chennai", 13.0827, 80.2707)
BENGALURU = ("Bengaluru", 12.9716, 77.5946)

ALL_RULES = [
    VelocityRule,
    UnusualAmountRule,
    ImpossibleTravelRule,
    BalanceDrainRule,
    HighRiskMerchantRule,
    SharedDeviceRule,
]


@dataclass
class Txn:
    transaction_id: str = "T1"
    customer_id: str = "C1"
    amount: float = 1000.0
    currency: str = "INR"
    merchant: str | None = "Big Bazaar"
    city: str | None = "Chennai"
    latitude: float | None = 13.0827
    longitude: float | None = 80.2707
    timestamp: datetime = T0
    device_id: str | None = "D1"
    account_balance: float | None = 50000.0


def at(place, **kw) -> Txn:
    city, lat, lon = place
    return Txn(city=city, latitude=lat, longitude=lon, **kw)


def run(rule_cls, txn, history=(), session=None, **overrides) -> RuleResult:
    params = {**rule_cls.default_params, **overrides}
    result = rule_cls().evaluate(txn, RuleContext(list(history), session), params)
    assert isinstance(result, RuleResult)
    assert result.rule_name == rule_cls.name
    assert isinstance(result.reason, str) and result.reason.strip(), "every result needs a reason"
    assert isinstance(result.details, dict)
    return result


# ---------------------------------------------------------------- metadata


@pytest.mark.parametrize(
    ("rule_cls", "name", "display_name", "score", "params"),
    [
        (VelocityRule, "velocity", "Transaction velocity", 30,
         {"window_minutes": 10, "max_transactions": 5}),
        (UnusualAmountRule, "unusual_amount", "Unusual transaction amount", 30,
         {"multiplier": 3.0, "min_history": 3, "lookback": 30, "new_customer_limit": 50000}),
        (ImpossibleTravelRule, "impossible_travel", "Impossible travel", 50,
         {"min_distance_km": 50, "max_speed_kmh": 900, "min_elapsed_minutes": 1}),
        (BalanceDrainRule, "balance_drain", "Balance drain", 25, {"max_ratio": 0.8}),
        (HighRiskMerchantRule, "high_risk_merchant", "High-risk merchant watchlist", 20,
         {"merchants": ["CryptoXchange", "QuickGiftCards"]}),
        (SharedDeviceRule, "shared_device", "Shared device (fraud ring)", 40,
         {"min_customers": 3, "lookback_days": 30}),
    ],
)
def test_rule_metadata(rule_cls, name, display_name, score, params):
    assert rule_cls.name == name
    assert rule_cls.display_name == display_name
    assert rule_cls.default_score == score
    assert rule_cls.default_params == params
    assert rule_cls.description.strip()


# ---------------------------------------------------------------- velocity


def _burst(n, start=T0, step_seconds=90, customer="C102"):
    return [
        Txn(transaction_id=f"H{i}", customer_id=customer, timestamp=start + timedelta(seconds=i * step_seconds))
        for i in range(n)
    ]


def test_velocity_fires_on_sixth_rapid_payment():
    history = _burst(5)  # 12:00:00 .. 12:06:00
    txn = Txn(transaction_id="T010", customer_id="C102", timestamp=T0 + timedelta(seconds=450))
    r = run(VelocityRule, txn, history)
    assert r.triggered
    assert r.reason == "6 transactions in the last 10 minutes (threshold: 5)"
    assert r.details["count"] == 6
    assert r.details["window_minutes"] == 10
    assert r.details["threshold"] == 5
    assert r.details["transaction_ids"] == ["H0", "H1", "H2", "H3", "H4", "T010"]


def test_velocity_fires_at_threshold_demo_t009():
    history = _burst(4)  # T005..T008
    txn = Txn(transaction_id="T009", customer_id="C102", timestamp=T0 + timedelta(minutes=6))
    r = run(VelocityRule, txn, history)
    assert r.triggered
    assert r.details["count"] == 5
    assert r.reason == "5 transactions in the last 10 minutes (threshold: 5)"


def test_velocity_four_in_window_passes():
    history = _burst(3)
    txn = Txn(transaction_id="T4", timestamp=T0 + timedelta(minutes=5))
    r = run(VelocityRule, txn, history)
    assert not r.triggered
    assert r.details["count"] == 4
    assert r.reason == "Passed: 4 transactions in the last 10 minutes (threshold: 5)"


def test_velocity_window_boundary_is_inclusive():
    now = T0 + timedelta(minutes=20)
    history = [
        Txn(transaction_id="OLD", timestamp=now - timedelta(minutes=10, seconds=1)),  # outside
        Txn(transaction_id="EDGE", timestamp=now - timedelta(minutes=10)),  # exactly on the boundary
        Txn(transaction_id="A", timestamp=now - timedelta(minutes=5)),
        Txn(transaction_id="B", timestamp=now - timedelta(minutes=3)),
        Txn(transaction_id="C", timestamp=now - timedelta(minutes=1)),
    ]
    r = run(VelocityRule, Txn(transaction_id="NOW", timestamp=now), history)
    assert r.triggered
    assert r.details["count"] == 5
    assert "OLD" not in r.details["transaction_ids"]
    assert "EDGE" in r.details["transaction_ids"]
    assert r.details["transaction_ids"][-1] == "NOW"


def test_velocity_single_transaction_passes():
    r = run(VelocityRule, Txn())
    assert not r.triggered
    assert r.details["count"] == 1
    assert r.reason == "Passed: 1 transaction in the last 10 minutes (threshold: 5)"


def test_velocity_respects_params():
    history = _burst(2)
    txn = Txn(timestamp=T0 + timedelta(minutes=3))
    r = run(VelocityRule, txn, history, window_minutes=5, max_transactions=3)
    assert r.triggered
    assert r.reason == "3 transactions in the last 5 minutes (threshold: 3)"


# ---------------------------------------------------------------- unusual amount


def _hist(*amounts):
    return [
        Txn(transaction_id=f"H{i}", amount=a, timestamp=T0 - timedelta(hours=len(amounts) - i))
        for i, a in enumerate(amounts)
    ]


def test_unusual_amount_average_mode_fires_demo_t014():
    r = run(UnusualAmountRule, Txn(amount=25000), _hist(1000, 1200, 800))
    assert r.triggered
    assert r.reason == "₹25,000 is 25.0× this customer's average of ₹1,000 (threshold: 3.0×)"
    d = r.details
    assert d["mode"] == "average"
    assert d["amount"] == 25000
    assert d["average"] == pytest.approx(1000)
    assert d["ratio"] == pytest.approx(25.0)
    assert d["history_count"] == 3
    assert d["multiplier"] == 3.0
    assert d["new_customer_limit"] == 50000


def test_unusual_amount_demo_t020_is_30x():
    r = run(UnusualAmountRule, Txn(amount=60000), _hist(2000, 2000, 2000))
    assert r.triggered
    assert "30.0×" in r.reason
    assert r.reason.startswith("₹60,000 is 30.0× this customer's average of ₹2,000")


def test_unusual_amount_exactly_multiplier_times_average_fires():
    r = run(UnusualAmountRule, Txn(amount=3000), _hist(1000, 1000, 1000))
    assert r.triggered
    assert r.details["ratio"] == pytest.approx(3.0)


def test_unusual_amount_average_mode_passes():
    r = run(UnusualAmountRule, Txn(amount=1500), _hist(600, 700, 650))
    assert not r.triggered
    assert r.reason == "Passed: ₹1,500 is 2.3× the average of ₹650 (threshold: 3.0×)"


def test_unusual_amount_demo_t028_2_8x_passes():
    r = run(UnusualAmountRule, Txn(amount=8500), _hist(3000, 2500, 3500))
    assert not r.triggered
    assert "2.8×" in r.reason
    assert r.reason.startswith("Passed: ")


def test_unusual_amount_new_customer_fires_demo_t021():
    r = run(UnusualAmountRule, Txn(amount=75000))
    assert r.triggered
    assert r.reason == "Only 0 previous transactions; ₹75,000 exceeds the new-customer limit of ₹50,000"
    d = r.details
    assert d["mode"] == "new_customer"
    assert d["average"] is None
    assert d["ratio"] is None
    assert d["history_count"] == 0


def test_unusual_amount_new_customer_passes_singular():
    r = run(UnusualAmountRule, Txn(amount=450), _hist(300))
    assert not r.triggered
    assert r.reason == "Passed: only 1 previous transaction; ₹450 is below the new-customer limit of ₹50,000"
    assert r.details["mode"] == "new_customer"
    assert r.details["history_count"] == 1


def test_unusual_amount_new_customer_limit_is_inclusive():
    r = run(UnusualAmountRule, Txn(amount=50000), _hist(100, 200))
    assert r.triggered
    assert r.details["mode"] == "new_customer"


def test_unusual_amount_zero_average_falls_back_to_new_customer_mode():
    history = _hist(0, 0, 0)
    small = run(UnusualAmountRule, Txn(amount=100), history)
    assert not small.triggered
    assert small.details["mode"] == "new_customer"
    big = run(UnusualAmountRule, Txn(amount=60000), history)
    assert big.triggered
    assert big.details["mode"] == "new_customer"


def test_unusual_amount_uses_only_lookback_most_recent():
    # old big payments are outside a lookback of 3
    history = _hist(90000, 90000, 1000, 1000, 1000)
    r = run(UnusualAmountRule, Txn(amount=5000), history, lookback=3)
    assert r.triggered
    assert r.details["history_count"] == 3
    assert r.details["average"] == pytest.approx(1000)


# ---------------------------------------------------------------- impossible travel


def test_travel_no_history_passes():
    r = run(ImpossibleTravelRule, at(DELHI))
    assert not r.triggered
    assert r.reason == "Passed: no previous transaction to compare"


def test_travel_missing_coordinates_skipped():
    prev = at(CHENNAI, transaction_id="P", timestamp=T0)
    cur = Txn(transaction_id="C", city="Delhi", latitude=None, longitude=None, timestamp=T0 + timedelta(minutes=30))
    r = run(ImpossibleTravelRule, cur, [prev])
    assert not r.triggered
    assert r.reason == "Skipped: location not available"

    prev_missing = Txn(transaction_id="P", latitude=None, longitude=77.0, timestamp=T0)
    r2 = run(ImpossibleTravelRule, at(DELHI, timestamp=T0 + timedelta(minutes=30)), [prev_missing])
    assert not r2.triggered
    assert r2.reason == "Skipped: location not available"


def test_travel_demo_t016_chennai_to_delhi_in_30_min_fires():
    prev = at(CHENNAI, transaction_id="T015", timestamp=datetime(2026, 10, 1, 10, 0))
    cur = at(DELHI, transaction_id="T016", timestamp=datetime(2026, 10, 1, 10, 30))
    r = run(ImpossibleTravelRule, cur, [prev])
    assert r.triggered
    assert r.reason == "1,756 km from Chennai to Delhi in 30 min — implied speed 3,512 km/h (max: 900 km/h)"
    d = r.details
    assert d["previous_transaction_id"] == "T015"
    assert d["previous_city"] == "Chennai"
    assert d["previous_latitude"] == 13.0827
    assert d["previous_longitude"] == 80.2707
    assert d["previous_timestamp"] == "2026-10-01T10:00:00"
    assert d["current_city"] == "Delhi"
    assert d["current_latitude"] == 28.6139
    assert d["current_longitude"] == 77.2090
    assert d["distance_km"] == pytest.approx(1755.8, abs=0.1)
    assert d["elapsed_minutes"] == 30.0
    assert d["speed_kmh"] == 3512
    assert d["max_speed_kmh"] == 900


def test_travel_demo_t020_mumbai_to_delhi_in_40_min_fires():
    prev = at(MUMBAI, transaction_id="T019", timestamp=datetime(2026, 10, 1, 8, 20))
    cur = at(DELHI, transaction_id="T020", timestamp=datetime(2026, 10, 1, 9, 0))
    r = run(ImpossibleTravelRule, cur, [prev])
    assert r.triggered
    assert r.reason == "1,148 km from Mumbai to Delhi in 40 min — implied speed 1,722 km/h (max: 900 km/h)"
    assert r.details["speed_kmh"] == 1722


def test_travel_plausible_flight_passes_demo_t024():
    prev = at(CHENNAI, transaction_id="T023", timestamp=datetime(2026, 10, 1, 8, 0))
    cur = at(DELHI, transaction_id="T024", timestamp=datetime(2026, 10, 1, 12, 0))
    r = run(ImpossibleTravelRule, cur, [prev])
    assert not r.triggered
    assert r.reason == "Passed: 1,756 km in 4 h 0 min — implied speed 439 km/h (max: 900 km/h)"
    assert r.details["speed_kmh"] == 439


def test_travel_under_min_distance_passes_even_if_fast():
    # ~30 km in 1 minute would be 1,800 km/h, but short hops are GPS/city noise
    prev = at(CHENNAI, transaction_id="P", timestamp=T0)
    cur = Txn(transaction_id="C", city="Chennai", latitude=13.0827 + 0.27, longitude=80.2707,
              timestamp=T0 + timedelta(minutes=1))
    r = run(ImpossibleTravelRule, cur, [prev])
    assert not r.triggered
    assert r.details["distance_km"] < 50
    assert r.reason.startswith("Passed: ")
    assert r.reason.endswith("km from previous transaction")


def test_travel_same_place_passes():
    prev = at(CHENNAI, transaction_id="P", timestamp=T0)
    r = run(ImpossibleTravelRule, at(CHENNAI, transaction_id="C", timestamp=T0 + timedelta(minutes=5)), [prev])
    assert not r.triggered
    assert r.reason == "Passed: 0 km from previous transaction"


def test_travel_one_minute_floor_avoids_division_by_zero():
    prev = at(CHENNAI, transaction_id="P", timestamp=T0)
    same_time = at(DELHI, transaction_id="C", timestamp=T0)
    r = run(ImpossibleTravelRule, same_time, [prev])
    assert r.triggered
    assert r.details["elapsed_minutes"] == 0.0
    # effective time is 1 minute -> speed = distance * 60
    assert r.details["speed_kmh"] == pytest.approx(r.details["distance_km"] * 60, rel=1e-3)

    half_minute = at(DELHI, transaction_id="C2", timestamp=T0 + timedelta(seconds=30))
    r2 = run(ImpossibleTravelRule, half_minute, [prev])
    assert r2.details["speed_kmh"] == pytest.approx(r2.details["distance_km"] * 60, rel=1e-3)


def test_travel_uses_last_history_item():
    old = at(DELHI, transaction_id="OLD", timestamp=T0 - timedelta(hours=10))
    prev = at(CHENNAI, transaction_id="PREV", timestamp=T0 - timedelta(minutes=30))
    r = run(ImpossibleTravelRule, at(DELHI, transaction_id="NOW", timestamp=T0), [old, prev])
    assert r.triggered
    assert r.details["previous_transaction_id"] == "PREV"


def test_travel_missing_city_names_use_placeholders():
    prev = Txn(transaction_id="P", city=None, latitude=13.0827, longitude=80.2707, timestamp=T0)
    cur = Txn(transaction_id="C", city=None, latitude=28.6139, longitude=77.2090,
              timestamp=T0 + timedelta(minutes=30))
    r = run(ImpossibleTravelRule, cur, [prev])
    assert r.triggered
    assert r.reason.startswith("1,756 km from previous location to this location in 30 min")


# ---------------------------------------------------------------- balance drain


def test_balance_drain_fires_demo_t020():
    r = run(BalanceDrainRule, Txn(amount=60000, account_balance=65000))
    assert r.triggered
    assert r.reason == "₹60,000 uses 92% of the available balance of ₹65,000 (threshold: 80%)"
    assert r.details == {"amount": 60000, "account_balance": 65000, "ratio": 0.923, "max_ratio": 0.8}


def test_balance_drain_fires_demo_t028_85_percent():
    r = run(BalanceDrainRule, Txn(amount=8500, account_balance=10000))
    assert r.triggered
    assert "85%" in r.reason
    assert r.details["ratio"] == 0.85


def test_balance_drain_exactly_80_percent_fires():
    r = run(BalanceDrainRule, Txn(amount=8000, account_balance=10000))
    assert r.triggered
    assert r.details["ratio"] == 0.8


def test_balance_drain_79_percent_passes():
    r = run(BalanceDrainRule, Txn(amount=7900, account_balance=10000))
    assert not r.triggered
    assert r.reason == "Passed: ₹7,900 is 79% of the available balance of ₹10,000 (threshold: 80%)"


def test_balance_drain_small_payment_passes():
    r = run(BalanceDrainRule, Txn(amount=450, account_balance=50000))
    assert not r.triggered
    assert r.reason == "Passed: ₹450 is 1% of the available balance of ₹50,000 (threshold: 80%)"


@pytest.mark.parametrize("balance", [None, 0, 0.0, -100])
def test_balance_drain_missing_or_zero_balance_skipped(balance):
    r = run(BalanceDrainRule, Txn(amount=60000, account_balance=balance))
    assert not r.triggered
    assert r.reason == "Skipped: account balance not provided"


# ---------------------------------------------------------------- high-risk merchant


def test_merchant_on_watchlist_fires():
    r = run(HighRiskMerchantRule, Txn(merchant="QuickGiftCards"))
    assert r.triggered
    assert r.reason == "Merchant 'QuickGiftCards' is on the high-risk watchlist"
    assert r.details == {"merchant": "QuickGiftCards", "watchlist_size": 2}


@pytest.mark.parametrize("merchant", ["  quickgiftcards ", "CRYPTOXCHANGE", "\tCryptoXchange\n"])
def test_merchant_match_is_case_and_whitespace_insensitive(merchant):
    assert run(HighRiskMerchantRule, Txn(merchant=merchant)).triggered


def test_merchant_not_on_watchlist_passes():
    r = run(HighRiskMerchantRule, Txn(merchant="Big Bazaar"))
    assert not r.triggered
    assert r.reason == "Passed: merchant 'Big Bazaar' is not on the watchlist"


@pytest.mark.parametrize("merchant", [None, "", "   "])
def test_no_merchant_passes(merchant):
    r = run(HighRiskMerchantRule, Txn(merchant=merchant))
    assert not r.triggered
    assert r.reason == "Passed: no merchant provided"


def test_merchant_watchlist_param_override():
    r = run(HighRiskMerchantRule, Txn(merchant="Casino Royale"), merchants=["casino royale"])
    assert r.triggered
    assert r.details["watchlist_size"] == 1


# ---------------------------------------------------------------- shared device


@pytest.fixture
def session():
    import app.models  # noqa: F401  - registers the tables on Base.metadata

    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        yield s
    engine.dispose()


def _add(session, tid, customer, device, ts):
    from app.models import Transaction

    session.add(
        Transaction(
            transaction_id=tid,
            customer_id=customer,
            amount=1000.0,
            currency="INR",
            merchant="Amazon Pay",
            city="Hyderabad",
            latitude=17.3850,
            longitude=78.4867,
            timestamp=ts,
            device_id=device,
            account_balance=20000.0,
        )
    )
    session.flush()


def _device_txn(tid, customer, device, ts):
    return Txn(transaction_id=tid, customer_id=customer, device_id=device, timestamp=ts)


def test_shared_device_two_customers_pass(session):
    _add(session, "T029", "C201", "D900", T0)
    _add(session, "T030", "C202", "D900", T0 + timedelta(minutes=20))
    r = run(SharedDeviceRule, _device_txn("T030", "C202", "D900", T0 + timedelta(minutes=20)), session=session)
    assert not r.triggered
    assert r.reason == "Passed: device D900 used by 2 customers in the last 30 days (threshold: 3)"
    assert r.details["customer_count"] == 2
    assert r.details["customer_ids"] == ["C201", "C202"]


def test_shared_device_three_customers_fire(session):
    for i, cust in enumerate(["C201", "C202", "C203"]):
        _add(session, f"T{29 + i:03d}", cust, "D900", T0 + timedelta(minutes=20 * i))
    r = run(SharedDeviceRule, _device_txn("T031", "C203", "D900", T0 + timedelta(minutes=40)), session=session)
    assert r.triggered
    assert r.reason == (
        "Device D900 was used by 3 different customers in the last 30 days (threshold: 3): C201, C202, C203"
    )
    assert r.details == {
        "device_id": "D900",
        "customer_count": 3,
        "customer_ids": ["C201", "C202", "C203"],
        "lookback_days": 30,
        "threshold": 3,
    }


def test_shared_device_four_customers_reason(session):
    for i, cust in enumerate(["C201", "C202", "C203", "C204"]):
        _add(session, f"T{29 + i:03d}", cust, "D900", T0 + timedelta(minutes=20 * i))
    r = run(SharedDeviceRule, _device_txn("T032", "C204", "D900", T0 + timedelta(minutes=60)), session=session)
    assert r.triggered
    assert r.reason == (
        "Device D900 was used by 4 different customers in the last 30 days (threshold: 3): "
        "C201, C202, C203, C204"
    )


def test_shared_device_single_customer_passes(session):
    _add(session, "T001", "C101", "D101", T0)
    _add(session, "T002", "C101", "D101", T0 + timedelta(hours=1))
    r = run(SharedDeviceRule, _device_txn("T002", "C101", "D101", T0 + timedelta(hours=1)), session=session)
    assert not r.triggered
    assert r.reason == "Passed: device D101 used by 1 customer in the last 30 days (threshold: 3)"


def test_shared_device_ignores_customers_outside_lookback(session):
    now = T0 + timedelta(days=40)
    _add(session, "OLD", "C201", "D900", now - timedelta(days=31))
    _add(session, "EDGE", "C202", "D900", now - timedelta(days=30))  # boundary is inclusive
    _add(session, "NOW", "C203", "D900", now)
    r = run(SharedDeviceRule, _device_txn("NOW", "C203", "D900", now), session=session)
    assert not r.triggered
    assert r.details["customer_ids"] == ["C202", "C203"]
    assert r.details["customer_count"] == 2

    # a third in-window customer makes it fire; the old one still does not count
    _add(session, "MID", "C204", "D900", now - timedelta(days=10))
    r2 = run(SharedDeviceRule, _device_txn("NOW", "C203", "D900", now), session=session)
    assert r2.triggered
    assert r2.details["customer_ids"] == ["C202", "C203", "C204"]


def test_shared_device_ignores_later_transactions(session):
    now = T0
    _add(session, "LATER", "C201", "D900", now + timedelta(hours=1))
    _add(session, "BEFORE", "C202", "D900", now - timedelta(hours=1))
    _add(session, "NOW", "C203", "D900", now)
    r = run(SharedDeviceRule, _device_txn("NOW", "C203", "D900", now), session=session)
    assert not r.triggered
    assert r.details["customer_ids"] == ["C202", "C203"]


def test_shared_device_ignores_other_devices(session):
    _add(session, "A", "C201", "D900", T0)
    _add(session, "B", "C202", "D901", T0)
    _add(session, "C", "C203", "D902", T0)
    r = run(SharedDeviceRule, _device_txn("A", "C201", "D900", T0), session=session)
    assert not r.triggered
    assert r.details["customer_ids"] == ["C201"]


def test_shared_device_lists_at_most_50_sorted_ids(session):
    for i in range(60):
        _add(session, f"T{i}", f"C{i:03d}", "D666", T0 - timedelta(minutes=i))
    r = run(SharedDeviceRule, _device_txn("T0", "C000", "D666", T0), session=session)
    assert r.triggered
    assert r.details["customer_count"] == 60
    ids = r.details["customer_ids"]
    assert len(ids) == 50
    assert ids == sorted(ids)
    assert ids[0] == "C000"


@pytest.mark.parametrize("device", [None, "", "  "])
def test_shared_device_no_device_id_passes(session, device):
    r = run(SharedDeviceRule, _device_txn("T1", "C1", device, T0), session=session)
    assert not r.triggered
    assert r.reason == "Passed: no device id"


def test_shared_device_without_session_skipped():
    r = run(SharedDeviceRule, _device_txn("T1", "C1", "D900", T0))
    assert not r.triggered
    assert r.reason == "Skipped: device graph not available"


# ---------------------------------------------------------------- every rule, every case


@pytest.mark.parametrize("rule_cls", ALL_RULES, ids=lambda c: c.name)
@pytest.mark.parametrize(
    "txn,history",
    [
        (Txn(), []),
        (Txn(merchant=None, city=None, latitude=None, longitude=None, device_id=None, account_balance=None), []),
        (at(DELHI, amount=60000, merchant="QuickGiftCards", account_balance=65000),
         [at(MUMBAI, transaction_id=f"H{i}", amount=2000, timestamp=T0 - timedelta(minutes=40 * (3 - i)))
          for i in range(3)]),
        (at(BENGALURU, amount=99), _burst(5, start=T0 - timedelta(minutes=6))),
    ],
)
def test_every_result_has_a_reason(rule_cls, txn, history):
    run(rule_cls, txn, history)  # run() asserts a non-empty reason and a details dict
