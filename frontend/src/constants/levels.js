/**
 * Risk levels (plan Section 5 + 15.2.1). Compare levels by order, never by string.
 * Colors live in tokens.css; `hex` is only a fallback for non-CSS contexts.
 */

export const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Levels that create a flag with the default FLAG_MIN_LEVEL=MEDIUM. */
export const FLAG_LEVELS = ['MEDIUM', 'HIGH', 'CRITICAL'];

/** Inclusive lower score bound of each level. */
export const LEVEL_THRESHOLDS = { LOW: 0, MEDIUM: 25, HIGH: 50, CRITICAL: 75 };

function meta(value, label, slug, hex) {
  return {
    value,
    label,
    cssVar: `--level-${slug}`,
    softVar: `--level-${slug}-soft`,
    onSoftVar: `--level-${slug}-on-soft`,
    color: `var(--level-${slug})`,
    soft: `var(--level-${slug}-soft)`,
    onSoft: `var(--level-${slug}-on-soft)`,
    hex,
    min: LEVEL_THRESHOLDS[value],
  };
}

export const LEVEL_META = {
  LOW: meta('LOW', 'Low', 'low', '#667085'),
  MEDIUM: meta('MEDIUM', 'Medium', 'medium', '#F59E0B'),
  HIGH: meta('HIGH', 'High', 'high', '#F97316'),
  CRITICAL: meta('CRITICAL', 'Critical', 'critical', '#E11D48'),
};

export const LEVEL_OPTIONS = LEVELS.map((l) => ({ value: l, label: LEVEL_META[l].label }));
export const FLAG_LEVEL_OPTIONS = FLAG_LEVELS.map((l) => ({ value: l, label: LEVEL_META[l].label }));

/** Normalise any casing ("high" -> "HIGH"); unknown -> null. */
export function normalizeLevel(level) {
  if (!level) return null;
  const up = String(level).toUpperCase();
  return LEVEL_META[up] ? up : null;
}

/** Metadata for a level; unknown levels fall back to LOW styling. */
export function getLevelMeta(level) {
  return LEVEL_META[normalizeLevel(level)] || LEVEL_META.LOW;
}

/** 0..3 for known levels, -1 for unknown/empty. */
export function levelRank(level) {
  const n = normalizeLevel(level);
  return n ? LEVELS.indexOf(n) : -1;
}

/** true when level a >= level b (e.g. levelGte('CRITICAL', 'HIGH')). */
export function levelGte(a, b) {
  return levelRank(a) >= levelRank(b) && levelRank(a) !== -1;
}

/** Level from a 0-100 score (Section 5 table). */
export function levelFromScore(score) {
  const s = Number(score) || 0;
  if (s >= LEVEL_THRESHOLDS.CRITICAL) return 'CRITICAL';
  if (s >= LEVEL_THRESHOLDS.HIGH) return 'HIGH';
  if (s >= LEVEL_THRESHOLDS.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/** Highest level in a list (null if none known). */
export function maxLevel(levels) {
  let best = null;
  for (const l of levels || []) {
    if (levelRank(l) > levelRank(best)) best = normalizeLevel(l);
  }
  return best;
}

export function levelLabel(level) {
  const n = normalizeLevel(level);
  return n ? LEVEL_META[n].label : '—';
}
