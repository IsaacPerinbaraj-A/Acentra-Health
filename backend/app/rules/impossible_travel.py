"""Impossible travel (plan Section 8.3)."""

from __future__ import annotations

from app.engine.base import FraudRule, RuleResult, format_duration, format_number
from app.engine.geo import haversine_km


def _has_coords(t) -> bool:
    return getattr(t, "latitude", None) is not None and getattr(t, "longitude", None) is not None


class ImpossibleTravelRule(FraudRule):
    name = "impossible_travel"
    display_name = "Impossible travel"
    description = (
        "Fires when the distance from the customer's previous payment could not be covered "
        "in the time between the two payments."
    )
    default_score = 50
    default_params = {"min_distance_km": 50, "max_speed_kmh": 900, "min_elapsed_minutes": 1}

    def evaluate(self, txn, ctx, params):
        min_distance = float(params["min_distance_km"])
        max_speed = float(params["max_speed_kmh"])
        min_elapsed = float(params["min_elapsed_minutes"])

        if not ctx.history:
            return RuleResult(self.name, False, "Passed: no previous transaction to compare", {})
        prev = ctx.history[-1]
        if not _has_coords(prev) or not _has_coords(txn):
            return RuleResult(
                self.name,
                False,
                "Skipped: location not available",
                {"previous_transaction_id": getattr(prev, "transaction_id", None)},
            )

        distance_km = haversine_km(prev.latitude, prev.longitude, txn.latitude, txn.longitude)
        elapsed_minutes = (txn.timestamp - prev.timestamp).total_seconds() / 60.0
        effective_hours = max(elapsed_minutes, min_elapsed) / 60.0
        speed_kmh = distance_km / effective_hours if effective_hours > 0 else float("inf")

        details = {
            "previous_transaction_id": prev.transaction_id,
            "previous_city": getattr(prev, "city", None),
            "previous_latitude": prev.latitude,
            "previous_longitude": prev.longitude,
            "previous_timestamp": prev.timestamp.isoformat(),
            "current_city": getattr(txn, "city", None),
            "current_latitude": txn.latitude,
            "current_longitude": txn.longitude,
            "distance_km": round(distance_km, 1),
            "elapsed_minutes": round(elapsed_minutes, 1),
            "speed_kmh": round(speed_kmh),
            "max_speed_kmh": params["max_speed_kmh"],
        }

        dist_txt = f"{format_number(distance_km)} km"
        if distance_km < min_distance:
            return RuleResult(self.name, False, f"Passed: {dist_txt} from previous transaction", details)

        duration = format_duration(elapsed_minutes)
        speed_txt = (
            f"implied speed {format_number(speed_kmh)} km/h (max: {format_number(max_speed)} km/h)"
        )
        if speed_kmh > max_speed:
            from_city = getattr(prev, "city", None) or "previous location"
            to_city = getattr(txn, "city", None) or "this location"
            reason = f"{dist_txt} from {from_city} to {to_city} in {duration} — {speed_txt}"
            return RuleResult(self.name, True, reason, details)

        return RuleResult(self.name, False, f"Passed: {dist_txt} in {duration} — {speed_txt}", details)
