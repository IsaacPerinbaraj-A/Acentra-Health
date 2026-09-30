"""High-risk merchant watchlist (plan Section 8.5)."""

from __future__ import annotations

from app.engine.base import FraudRule, RuleResult


def _watchlist(value) -> list[str]:
    if isinstance(value, str):
        value = value.split(",")
    return [str(m).strip() for m in (value or []) if str(m).strip()]


class HighRiskMerchantRule(FraudRule):
    name = "high_risk_merchant"
    display_name = "High-risk merchant watchlist"
    description = "Fires when the merchant is on the high-risk watchlist (e.g. crypto exchanges, gift cards)."
    default_score = 20
    default_params = {"merchants": ["CryptoXchange", "QuickGiftCards"]}

    def evaluate(self, txn, ctx, params):
        watchlist = _watchlist(params.get("merchants"))
        merchant = (getattr(txn, "merchant", None) or "").strip()
        details = {"merchant": merchant or None, "watchlist_size": len(watchlist)}

        if not merchant:
            return RuleResult(self.name, False, "Passed: no merchant provided", details)
        if merchant.lower() in {m.lower() for m in watchlist}:
            return RuleResult(
                self.name, True, f"Merchant '{merchant}' is on the high-risk watchlist", details
            )
        return RuleResult(
            self.name, False, f"Passed: merchant '{merchant}' is not on the watchlist", details
        )
