"""Balance drain (plan Section 8.4). ``account_balance`` is the balance *before* the payment."""

from __future__ import annotations

from app.engine.base import FraudRule, RuleResult, format_inr

_EPS = 1e-9


class BalanceDrainRule(FraudRule):
    name = "balance_drain"
    display_name = "Balance drain"
    description = "Fires when a single payment uses most of the available account balance (cash-out)."
    default_score = 25
    default_params = {"max_ratio": 0.8}

    def evaluate(self, txn, ctx, params):
        max_ratio = float(params["max_ratio"])
        amount = float(txn.amount)
        balance = getattr(txn, "account_balance", None)

        if balance is None or float(balance) <= 0:
            return RuleResult(
                self.name,
                False,
                "Skipped: account balance not provided",
                {
                    "amount": amount,
                    "account_balance": balance,
                    "ratio": None,
                    "max_ratio": params["max_ratio"],
                },
            )

        balance = float(balance)
        ratio = amount / balance
        triggered = ratio >= max_ratio - _EPS
        details = {
            "amount": amount,
            "account_balance": balance,
            "ratio": round(ratio, 3),
            "max_ratio": params["max_ratio"],
        }
        pct = f"{ratio * 100:.0f}%"
        threshold = f"{max_ratio * 100:.0f}%"
        if triggered:
            reason = (
                f"{format_inr(amount)} uses {pct} of the available balance of "
                f"{format_inr(balance)} (threshold: {threshold})"
            )
        else:
            reason = (
                f"Passed: {format_inr(amount)} is {pct} of the available balance of "
                f"{format_inr(balance)} (threshold: {threshold})"
            )
        return RuleResult(self.name, triggered, reason, details)
