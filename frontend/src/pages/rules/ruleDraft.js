/**
 * Draft helpers for the Rules page: turn a RuleOut into editable form values,
 * detect dirty fields and build the PATCH / backtest payload.
 */

export function humanizeKey(key) {
  const s = String(key || '').replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

export function paramKeys(rule) {
  const keys = [];
  const seen = new Set();
  [rule?.default_params || {}, rule?.params || {}].forEach((obj) => {
    Object.keys(obj).forEach((k) => {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    });
  });
  return keys;
}

/** 'number' | 'list' | 'boolean' | 'string' | 'json' — from default_params, falling back to params. */
export function paramType(rule, key) {
  const dp = rule?.default_params || {};
  const v = key in dp ? dp[key] : rule?.params?.[key];
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  return 'json';
}

/** step 1 for integer params, 0.1 otherwise. */
export function paramStep(rule, key) {
  const d = rule?.default_params?.[key];
  const c = rule?.params?.[key];
  const isInt = (x) => x === undefined || x === null || Number.isInteger(Number(x));
  return isInt(d) && isInt(c) ? 1 : 0.1;
}

function listToText(v) {
  return Array.isArray(v) ? v.map((x) => String(x)).join(', ') : v == null ? '' : String(v);
}

function textToList(text) {
  return String(text || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatDefault(type, value) {
  if (value === undefined) return '—';
  if (type === 'list') return listToText(value) || '(empty)';
  if (type === 'boolean') return value ? 'On' : 'Off';
  if (type === 'json') return JSON.stringify(value);
  return String(value);
}

export function toDraft(rule) {
  const params = {};
  paramKeys(rule).forEach((key) => {
    const type = paramType(rule, key);
    const v = rule?.params?.[key] ?? rule?.default_params?.[key];
    if (type === 'list') params[key] = listToText(v);
    else if (type === 'json') params[key] = v === undefined ? '' : JSON.stringify(v);
    else params[key] = v;
  });
  return { enabled: !!rule?.enabled, score: Number(rule?.score ?? 0), params };
}

/** Normalised value for one param + optional validation error. */
function normalizeParam(type, value) {
  if (type === 'list') return { value: textToList(value) };
  if (type === 'number') {
    const n = typeof value === 'number' ? value : value === '' || value == null ? NaN : Number(value);
    return Number.isFinite(n) ? { value: n } : { value: null, error: 'Enter a number' };
  }
  if (type === 'boolean') return { value: !!value };
  if (type === 'json') {
    try {
      return { value: JSON.parse(value) };
    } catch {
      return { value: null, error: 'Invalid JSON' };
    }
  }
  return { value: value == null ? '' : String(value) };
}

function sameParam(type, a, b) {
  if (type === 'list') {
    const bb = Array.isArray(b) ? b.map((x) => String(x).trim()) : b;
    return JSON.stringify(a) === JSON.stringify(bb);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compare draft to rule.
 * -> { dirty, changes: {enabled?, score?, params?}, errors: {score?, [paramKey]?}, hasErrors }
 * `params` (when present) is the full effective params object with edits applied.
 */
export function diffDraft(rule, draft) {
  const changes = {};
  const errors = {};

  if (draft.enabled !== !!rule.enabled) changes.enabled = draft.enabled;

  const score = typeof draft.score === 'number' ? draft.score : Number(draft.score);
  if (!Number.isFinite(score)) errors.score = 'Enter a number';
  else if (score < 0 || score > 100) errors.score = 'Must be between 0 and 100';
  else if (score !== Number(rule.score)) changes.score = score;

  const nextParams = { ...(rule.params || {}) };
  let paramsChanged = false;
  paramKeys(rule).forEach((key) => {
    const type = paramType(rule, key);
    const { value, error } = normalizeParam(type, draft.params[key]);
    if (error) {
      errors[key] = error;
      return;
    }
    if (!sameParam(type, value, rule.params?.[key])) {
      paramsChanged = true;
      nextParams[key] = value;
    }
  });
  if (paramsChanged) changes.params = nextParams;

  const hasErrors = Object.keys(errors).length > 0;
  const dirty = hasErrors || Object.keys(changes).length > 0;
  return { dirty, changes, errors, hasErrors };
}
