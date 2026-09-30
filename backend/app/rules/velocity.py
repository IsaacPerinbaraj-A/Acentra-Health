"""Transaction velocity (plan Section 8.1)."""

from __future__ import annotations

from datetime import timedelta

from app.engine.base import FraudRule, RuleResult, fmt_param, plural


class VelocityRule(FraudRule):
    name = "velocity"
    display_name = "Transaction velocity"
    description = "Fires when a customer makes many payments in a short time window (e.g. card testing)."
    default_score = 30
    default_params = {"window_minutes": 10, "max_transactions": 5}

    def evaluate(self, txn, ctx, params):
        window_minutes = params["window_minutes"]
        threshold = params["max_transactions"]
        window_start = txn.timestamp - timedelta(minutes=float(window_minutes))

        # The window boundary is inclusive and the current transaction counts.
        in_window = [h for h in ctx.history if window_start <= h.timestamp <= txn.timestamp]
        count = 1 + len(in_window)
        triggered = count >= threshold

        minutes_word = "minute" if window_minutes == 1 else "minutes"
        text = (
            f"{plural(count, 'transaction')} in the last {fmt_param(window_minutes)} {minutes_word} "
            f"(threshold: {fmt_param(threshold)})"
        )
        reason = text if triggered else f"Passed: {text}"
        details = {
            "count": count,
            "window_minutes": window_minutes,
            "threshold": threshold,
            "transaction_ids": [h.transaction_id for h in in_window] + [txn.transaction_id],
        }
        return RuleResult(self.name, triggered, reason, details)
