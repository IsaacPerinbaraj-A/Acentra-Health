/**
 * Plain-English explanations of rule results (plan Section 8 details + 15.2.4).
 *
 * explainFlag(results) -> "4 risk signals: amount 30× normal, impossible travel Mumbai → Delhi,
 *                          watchlist merchant, 92% of balance."
 * ruleSignal(result)   -> short phrase for one fired rule; unknown rules fall back to display_name.
 */
import { getRuleMeta } from '../constants/ruleMeta';
import { formatINR, formatNumber, formatPercent } from './format';

function num(v) {
  const n = Number(v);
  return v === null || v === undefined || v === '' || Number.isNaN(n) ? null : n;
}

function ratioText(r) {
  const n = num(r);
  if (n === null) return null;
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${formatNumber(rounded)}×`;
}

function lowerFirst(s) {
  const str = String(s || '');
  if (!str) return str;
  // keep acronyms ("VPN mismatch") intact
  if (str.length > 1 && str[1] === str[1].toUpperCase() && /[A-Z]/.test(str[1])) return str;
  return str.charAt(0).toLowerCase() + str.slice(1);
}

const PHRASES = {
  unusual_amount(d) {
    if (d.mode === 'new_customer') {
      const limit = num(d.new_customer_limit);
      return limit !== null
        ? `large first payment above the ${formatINR(limit)} new-customer limit`
        : 'large payment for a new customer';
    }
    const r = ratioText(d.ratio);
    return r ? `amount ${r} normal` : 'unusually large amount';
  },
  impossible_travel(d) {
    if (d.previous_city && d.current_city) return `impossible travel ${d.previous_city} → ${d.current_city}`;
    const speed = num(d.speed_kmh);
    return speed !== null ? `impossible travel (${formatNumber(Math.round(speed))} km/h)` : 'impossible travel';
  },
  high_risk_merchant() {
    return 'watchlist merchant';
  },
  balance_drain(d) {
    const r = num(d.ratio);
    return r !== null ? `${formatPercent(r)} of balance` : 'drains most of the balance';
  },
  velocity(d) {
    const c = num(d.count);
    const w = num(d.window_minutes);
    if (c !== null && w !== null) return `${c} payments in ${w} min`;
    return 'rapid burst of payments';
  },
  shared_device(d) {
    const c = num(d.customer_count);
    const dev = d.device_id ? ` ${d.device_id}` : '';
    return c !== null ? `device${dev} shared by ${c} customers` : 'device shared across customers';
  },
};

/** Short phrase describing why one fired rule matters. */
export function ruleSignal(result) {
  if (!result) return '';
  const fn = PHRASES[result.rule_name];
  if (fn) {
    try {
      const phrase = fn(result.details || {});
      if (phrase) return phrase;
    } catch {
      /* fall through to display name */
    }
  }
  return lowerFirst(result.display_name || getRuleMeta(result.rule_name).displayName);
}

/** Fired results only (keeps API order: fired first, highest impact first). */
export function firedResults(results) {
  return (results || []).filter((r) => r && r.triggered);
}

export function passedResults(results) {
  return (results || []).filter((r) => r && !r.triggered);
}

/** One-sentence summary of all fired rules. */
export function explainFlag(results) {
  const fired = firedResults(results);
  if (!fired.length) {
    return 'No risk signals fired — every rule passed for this transaction.';
  }
  const phrases = fired.map(ruleSignal).filter(Boolean);
  const n = fired.length;
  return `${n} risk signal${n === 1 ? '' : 's'}: ${phrases.join(', ')}.`;
}

/** Signals as an array of {name, text} (used to render emphasised phrases). */
export function explainSignals(results) {
  return firedResults(results).map((r) => ({ name: r.rule_name, text: ruleSignal(r), result: r }));
}

export default explainFlag;
