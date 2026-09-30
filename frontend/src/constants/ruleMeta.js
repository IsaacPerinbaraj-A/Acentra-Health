/**
 * Rule colors and icons (plan Section 15.2.1).
 * getRuleMeta(name) works for ANY rule name: unknown rules get a color from the
 * fallback palette chosen by hashing the name, and the ShieldAlert icon, so a new
 * backend rule renders nicely with zero frontend changes.
 */
import { Network, Plane, ShieldAlert, Store, TrendingUp, Wallet, Zap } from 'lucide-react';

export const RULE_META = {
  velocity: {
    color: '#0EA5E9',
    cssVar: '--rule-velocity',
    icon: Zap,
    displayName: 'Transaction velocity',
    shortName: 'Velocity',
  },
  unusual_amount: {
    color: '#8B5CF6',
    cssVar: '--rule-unusual-amount',
    icon: TrendingUp,
    displayName: 'Unusual transaction amount',
    shortName: 'Unusual amount',
  },
  impossible_travel: {
    color: '#EC4899',
    cssVar: '--rule-impossible-travel',
    icon: Plane,
    displayName: 'Impossible travel',
    shortName: 'Impossible travel',
  },
  balance_drain: {
    color: '#14B8A6',
    cssVar: '--rule-balance-drain',
    icon: Wallet,
    displayName: 'Balance drain',
    shortName: 'Balance drain',
  },
  high_risk_merchant: {
    color: '#84CC16',
    cssVar: '--rule-high-risk-merchant',
    icon: Store,
    displayName: 'High-risk merchant watchlist',
    shortName: 'Risky merchant',
  },
  shared_device: {
    color: '#A16207',
    cssVar: '--rule-shared-device',
    icon: Network,
    displayName: 'Shared device (fraud ring)',
    shortName: 'Shared device',
  },
};

export const KNOWN_RULES = Object.keys(RULE_META);

export const FALLBACK_RULE_COLORS = ['#64748B', '#0891B2', '#C026D3', '#65A30D'];
export const FALLBACK_RULE_ICON = ShieldAlert;

function hashString(str) {
  // djb2 — stable across sessions and browsers
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** "new_device" -> "New device" */
export function humanizeRuleName(name) {
  const s = String(name || '').replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown rule';
}

const cache = new Map();

/**
 * @param {string} name rule id, e.g. "velocity" or any unknown "new_device"
 * @param {string} [displayName] backend display_name (preferred label when given)
 * @returns {{name, displayName, shortName, color, cssVar, icon, known}}
 */
export function getRuleMeta(name, displayName) {
  const key = String(name || '');
  let base = cache.get(key);
  if (!base) {
    const known = RULE_META[key];
    if (known) {
      base = { name: key, known: true, ...known };
    } else {
      const idx = hashString(key) % FALLBACK_RULE_COLORS.length;
      base = {
        name: key,
        known: false,
        color: FALLBACK_RULE_COLORS[idx],
        cssVar: `--rule-fallback-${idx + 1}`,
        icon: FALLBACK_RULE_ICON,
        displayName: humanizeRuleName(key),
        shortName: humanizeRuleName(key),
      };
    }
    cache.set(key, base);
  }
  return displayName ? { ...base, displayName } : base;
}

export function ruleColor(name) {
  return getRuleMeta(name).color;
}

/**
 * Find the rule id for a display name (the flags list returns fired_rules as display names).
 * Falls back to a slug of the display name, which still hashes to a stable color.
 */
export function ruleNameFromDisplayName(displayName) {
  const d = String(displayName || '').trim().toLowerCase();
  for (const [name, m] of Object.entries(RULE_META)) {
    if (m.displayName.toLowerCase() === d || m.shortName.toLowerCase() === d || name === d) return name;
  }
  return d.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
