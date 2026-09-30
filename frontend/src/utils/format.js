/**
 * Formatting helpers (plan Sections 15.1, 15.2.5). All return '—' for null/undefined/invalid input.
 * Backend timestamps are naive ISO strings (Section 6.1); they are parsed as local time.
 */

export const DASH = '—';

const nfCache = new Map();
function nf(key, opts) {
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-IN', opts);
    nfCache.set(key, f);
  }
  return f;
}

function isNum(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}

/** formatINR(123456) -> "₹1,23,456"; formatINR(99.5) -> "₹99.50"; other currencies via ISO code. */
export function formatINR(amount, currency = 'INR') {
  if (!isNum(amount)) return DASH;
  const n = Number(amount);
  const whole = Math.abs(n % 1) < 1e-9;
  const cur = (currency || 'INR').toUpperCase();
  try {
    return nf(`cur-${cur}-${whole}`, {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(n);
  } catch {
    return `${cur} ${formatNumber(n, whole ? 0 : 2)}`;
  }
}

/** Alias */
export const formatAmount = formatINR;

/** Compact currency for chart axes: ₹1.2L, ₹25K */
export function formatINRCompact(amount, currency = 'INR') {
  if (!isNum(amount)) return DASH;
  try {
    return nf(`curc-${currency}`, {
      style: 'currency',
      currency: (currency || 'INR').toUpperCase(),
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(Number(amount));
  } catch {
    return formatINR(amount, currency);
  }
}

/** formatNumber(123456) -> "1,23,456"; formatNumber(3.14159, 2) -> "3.14" */
export function formatNumber(value, decimals) {
  if (!isNum(value)) return DASH;
  const n = Number(value);
  if (decimals === undefined) {
    return nf('num-auto', { maximumFractionDigits: 2 }).format(n);
  }
  return nf(`num-${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

/** 12500 -> "12.5K" */
export function formatCompactNumber(value) {
  if (!isNum(value)) return DASH;
  return nf('num-compact', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value));
}

/** formatPercent(0.92) -> "92%"; formatPercent(0.8567, 1) -> "85.7%"; ratios are 0..1 */
export function formatPercent(ratio, decimals = 0) {
  if (!isNum(ratio)) return DASH;
  return nf(`pct-${decimals}`, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(ratio));
}

/** Parse Date | ISO string | epoch ms. Naive ISO strings are treated as local time. */
export function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  let s = String(value).trim();
  // "2026-10-01 08:00:00" -> "2026-10-01T08:00:00"
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(' ', 'T');
  // Trim >3 fractional digits (Python microseconds) which some engines reject
  s = s.replace(/(\.\d{3})\d+/, '$1');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "01 Oct 2026, 08:00 am" */
export function formatDateTime(value, opts) {
  const d = parseDate(value);
  if (!d) return DASH;
  return d.toLocaleString(
    'en-IN',
    opts || { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  );
}

/** "01 Oct 2026, 08:00:15 am" */
export function formatDateTimeSeconds(value) {
  return formatDateTime(value, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** "01 Oct 2026" */
export function formatDate(value) {
  const d = parseDate(value);
  if (!d) return DASH;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "08:00 am" */
export function formatTime(value) {
  const d = parseDate(value);
  if (!d) return DASH;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * relativeTime(date, now = Date.now()) -> "just now", "12 min ago", "3 h ago", "2 d ago",
 * "in 5 min"; older than 30 days -> formatDate().
 */
export function relativeTime(value, now = Date.now()) {
  const d = parseDate(value);
  if (!d) return DASH;
  const diffSec = Math.round((now - d.getTime()) / 1000);
  const future = diffSec < 0;
  const s = Math.abs(diffSec);
  let text;
  if (s < 45) return future ? 'in a few seconds' : 'just now';
  if (s < 3600) text = `${Math.max(1, Math.round(s / 60))} min`;
  else if (s < 86400) text = `${Math.floor(s / 3600)} h`;
  else if (s < 86400 * 30) text = `${Math.floor(s / 86400)} d`;
  else return formatDate(d);
  return future ? `in ${text}` : `${text} ago`;
}

/** formatDuration(12) -> "12 min"; 245 -> "4 h 5 min"; 240 -> "4 h"; 3000 -> "2 d 2 h" */
export function formatDuration(minutes) {
  if (!isNum(minutes)) return DASH;
  const m = Math.max(0, Math.round(Number(minutes)));
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** formatDistanceKm(1148.2) -> "1,148 km" */
export function formatDistanceKm(km) {
  if (!isNum(km)) return DASH;
  return `${formatNumber(Math.round(Number(km)), 0)} km`;
}

/** formatSpeed(1722) -> "1,722 km/h" */
export function formatSpeed(kmh) {
  if (!isNum(kmh)) return DASH;
  return `${formatNumber(Math.round(Number(kmh)), 0)} km/h`;
}

/** initials("Ravi Kumar") -> "RK"; initials("C101") -> "C1"; initials("reviewer") -> "RE" */
export function initials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const words = s.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

/** pluralize(3, 'flag') -> "3 flags"; pluralize(1, 'customer') -> "1 customer" */
export function pluralize(count, singular, plural) {
  const n = Number(count) || 0;
  return `${formatNumber(n, 0)} ${n === 1 ? singular : plural || `${singular}s`}`;
}

/** formatBytes(2048) -> "2 KB" */
export function formatBytes(bytes) {
  if (!isNum(bytes)) return DASH;
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${formatNumber(b / 1024, b < 10240 ? 1 : 0)} KB`;
  return `${formatNumber(b / (1024 * 1024), 1)} MB`;
}

/** "2026-10-01" + end-of-day helpers for date filters sent to the API */
export function toApiDateTime(dateStr, endOfDay = false) {
  if (!dateStr) return undefined;
  if (dateStr.includes('T')) return dateStr;
  return `${dateStr}T${endOfDay ? '23:59:59' : '00:00:00'}`;
}
