"""Haversine distance (plan Section 7.6)."""

from __future__ import annotations

import pytest

from app.engine.geo import EARTH_RADIUS_KM, haversine_km

MUMBAI = (19.0760, 72.8777)
DELHI = (28.6139, 77.2090)
CHENNAI = (13.0827, 80.2707)


def test_earth_radius():
    assert EARTH_RADIUS_KM == 6371.0


def test_mumbai_to_delhi_is_about_1148_km():
    assert haversine_km(*MUMBAI, *DELHI) == pytest.approx(1148, abs=5)


def test_chennai_to_delhi_is_about_1756_km():
    assert haversine_km(*CHENNAI, *DELHI) == pytest.approx(1756, abs=5)


def test_same_point_is_zero():
    assert haversine_km(*MUMBAI, *MUMBAI) == 0
    assert haversine_km(0.0, 0.0, 0.0, 0.0) == 0


def test_distance_is_symmetric():
    assert haversine_km(*MUMBAI, *DELHI) == pytest.approx(haversine_km(*DELHI, *MUMBAI))


def test_antipodal_points_do_not_crash():
    # half the circumference, ~20,015 km
    assert haversine_km(0.0, 0.0, 0.0, 180.0) == pytest.approx(20015, abs=5)
