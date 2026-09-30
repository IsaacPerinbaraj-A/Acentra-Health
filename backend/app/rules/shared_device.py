"""Shared device / fraud ring (plan Section 8.6).

Graph view: customers and devices are nodes; one device used by many different
customers is a classic sign of a mule network, which per-customer rules cannot see.
"""

from __future__ import annotations

from datetime import timedelta

from app.engine.base import FraudRule, RuleResult, fmt_param, plural

MAX_LISTED_IDS = 50


class SharedDeviceRule(FraudRule):
    name = "shared_device"
    display_name = "Shared device (fraud ring)"
    description = "Fires when one device has been used by several different customers (possible fraud ring)."
    default_score = 40
    default_params = {"min_customers": 3, "lookback_days": 30}

    def evaluate(self, txn, ctx, params):
        threshold = int(params["min_customers"])
        lookback_days = params["lookback_days"]
        device_id = (getattr(txn, "device_id", None) or "").strip()

        if not device_id:
            return RuleResult(self.name, False, "Passed: no device id", {})
        if ctx.session is None:
            return RuleResult(
                self.name, False, "Skipped: device graph not available", {"device_id": device_id}
            )

        from sqlalchemy import select

        from app.models import Transaction

        window_start = txn.timestamp - timedelta(days=float(lookback_days))
        stmt = (
            select(Transaction.customer_id)
            .where(
                Transaction.device_id == device_id,
                Transaction.timestamp >= window_start,
                Transaction.timestamp <= txn.timestamp,
            )
            .distinct()
        )
        customers = {c for c in ctx.session.scalars(stmt) if c}
        # The current transaction is normally flushed already (Section 10 step 4);
        # adding it keeps the rule correct for unsaved objects (tests, what-if runs).
        if getattr(txn, "customer_id", None):
            customers.add(txn.customer_id)

        customer_ids = sorted(customers)
        count = len(customer_ids)
        triggered = count >= threshold
        days_txt = f"{fmt_param(lookback_days)} {'day' if lookback_days == 1 else 'days'}"
        details = {
            "device_id": device_id,
            "customer_count": count,
            "customer_ids": customer_ids[:MAX_LISTED_IDS],
            "lookback_days": lookback_days,
            "threshold": threshold,
        }
        if triggered:
            shown = customer_ids[:10]
            listed = ", ".join(shown)
            if count > len(shown):
                listed += f" and {count - len(shown)} more"
            reason = (
                f"Device {device_id} was used by {count} different customers in the last "
                f"{days_txt} (threshold: {threshold}): {listed}"
            )
        else:
            reason = (
                f"Passed: device {device_id} used by {plural(count, 'customer')} in the last "
                f"{days_txt} (threshold: {threshold})"
            )
        return RuleResult(self.name, triggered, reason, details)
