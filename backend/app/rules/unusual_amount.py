"""Unusual transaction amount (plan Section 8.2)."""

from __future__ import annotations

from app.engine.base import FraudRule, RuleResult, format_inr, plural

_EPS = 1e-9


class UnusualAmountRule(FraudRule):
    name = "unusual_amount"
    display_name = "Unusual transaction amount"
    description = (
        "Fires when a payment is far above the customer's average, or very large for a new customer."
    )
    default_score = 30
    default_params = {"multiplier": 3.0, "min_history": 3, "lookback": 30, "new_customer_limit": 50000}

    def evaluate(self, txn, ctx, params):
        multiplier = float(params["multiplier"])
        min_history = int(params["min_history"])
        lookback = int(params["lookback"])
        limit = float(params["new_customer_limit"])
        amount = float(txn.amount)

        recent = list(ctx.history)[-lookback:] if lookback > 0 else []
        n = len(recent)
        average = sum(float(h.amount) for h in recent) / n if n else 0.0

        details = {
            "mode": "average",
            "amount": amount,
            "average": None,
            "ratio": None,
            "history_count": n,
            "multiplier": params["multiplier"],
            "new_customer_limit": params["new_customer_limit"],
        }

        if n >= min_history and average > 0:
            ratio = amount / average
            triggered = amount >= multiplier * average - _EPS * max(1.0, amount)
            details.update(average=round(average, 2), ratio=round(ratio, 2))
            if triggered:
                reason = (
                    f"{format_inr(amount)} is {ratio:.1f}× this customer's average of "
                    f"{format_inr(average)} (threshold: {multiplier:.1f}×)"
                )
            else:
                reason = (
                    f"Passed: {format_inr(amount)} is {ratio:.1f}× the average of "
                    f"{format_inr(average)} (threshold: {multiplier:.1f}×)"
                )
            return RuleResult(self.name, triggered, reason, details)

        # New-customer mode: not enough history (or a zero average).
        details["mode"] = "new_customer"
        triggered = amount >= limit - _EPS * max(1.0, amount)
        prev = plural(n, "previous transaction")
        if triggered:
            reason = (
                f"Only {prev}; {format_inr(amount)} exceeds the new-customer limit of "
                f"{format_inr(limit)}"
            )
        else:
            reason = (
                f"Passed: only {prev}; {format_inr(amount)} is below the new-customer limit of "
                f"{format_inr(limit)}"
            )
        return RuleResult(self.name, triggered, reason, details)
