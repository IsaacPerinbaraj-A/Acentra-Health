import { useMemo } from 'react';
import { useTheme } from '../theme/ThemeContext';
import { LEVELS, LEVEL_META } from '../constants/levels';
import { STATUSES, STATUS_META } from '../constants/statuses';
import { getRuleMeta } from '../constants/ruleMeta';

/**
 * Chart styling (plan Section 15.2.6). Colors come ONLY from CSS variables, read at
 * runtime so charts follow the theme. useChartTheme() re-reads them when the theme changes.
 *
 * const t = useChartTheme();
 * <CartesianGrid {...t.grid} />
 * <XAxis dataKey="bucket" {...t.axis} />
 * <YAxis {...t.axis} />
 * <Bar dataKey="HIGH" stackId="a" fill={t.level.HIGH} radius={t.barRadius} animationDuration={t.animationDuration} />
 * <Tooltip content={<ChartTooltip />} cursor={t.cursor} />
 */

export function readCssVar(name, fallback = '') {
  if (typeof window === 'undefined' || !name) return fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function buildChartTheme() {
  const level = {};
  const levelSoft = {};
  const levelOnSoft = {};
  LEVELS.forEach((l) => {
    const m = LEVEL_META[l];
    level[l] = readCssVar(m.cssVar, m.hex);
    levelSoft[l] = readCssVar(m.softVar, m.hex);
    levelOnSoft[l] = readCssVar(m.onSoftVar, m.hex);
  });
  const status = {};
  const statusSoft = {};
  STATUSES.forEach((s) => {
    const m = STATUS_META[s];
    status[s] = readCssVar(m.cssVar, m.hex);
    statusSoft[s] = readCssVar(m.softVar, m.hex);
  });

  const text = readCssVar('--text');
  const text2 = readCssVar('--text-2');
  const text3 = readCssVar('--text-3');
  const border = readCssVar('--border');
  const borderStrong = readCssVar('--border-strong');
  const surface = readCssVar('--surface');
  const surface2 = readCssVar('--surface-2');
  const brand = readCssVar('--brand');
  const fontFamily = readCssVar('--font-sans', 'sans-serif');
  const monoFamily = readCssVar('--font-mono', 'monospace');
  const reduced = prefersReducedMotion();
  const animationDuration = reduced ? 0 : 400;

  const tick = { fill: text3, fontSize: 12, fontFamily };

  // level / status are callable AND indexable: t.level('HIGH') === t.level.HIGH
  const levelFn = Object.assign((l) => level[String(l || '').toUpperCase()] || level.LOW, level);
  const statusFn = Object.assign(
    (s) => status[String(s || '').toUpperCase()] || status.PENDING_REVIEW,
    status
  );

  return {
    level: levelFn,
    levelSoft,
    levelOnSoft,
    status: statusFn,
    statusSoft,
    /** rule(name) -> color for any rule name (hashed fallback for unknown rules) */
    rule: (name) => readCssVar(getRuleMeta(name).cssVar, getRuleMeta(name).color),
    feedback: {
      success: readCssVar('--success'),
      warning: readCssVar('--warning'),
      error: readCssVar('--error'),
      info: readCssVar('--info'),
    },
    text,
    text2,
    text3,
    border,
    borderStrong,
    surface,
    surface2,
    brand,
    brandSoft: readCssVar('--brand-soft'),
    fontFamily,
    monoFamily,
    reducedMotion: reduced,
    animationDuration,
    isAnimationActive: !reduced,
    barRadius: [4, 4, 0, 0],
    barRadiusHorizontal: [0, 4, 4, 0],
    /** spread on <CartesianGrid>: horizontal dashed lines only */
    grid: { stroke: border, strokeDasharray: '3 3', vertical: false },
    /** spread on <XAxis>/<YAxis>: 12 px text-3 labels, no axis/tick lines */
    axis: { axisLine: false, tickLine: false, tick, tickMargin: 8 },
    tick,
    /** tooltip cursor for bar charts */
    cursor: { fill: surface2, opacity: 0.6 },
    lineCursor: { stroke: borderStrong, strokeDasharray: '3 3' },
    /** spread on <Legend> for top-right rounded swatches */
    legend: {
      verticalAlign: 'top',
      align: 'right',
      iconType: 'circle',
      iconSize: 8,
      wrapperStyle: { fontSize: 12, color: text2, paddingBottom: 8, fontFamily },
    },
  };
}

export function useChartTheme() {
  const { theme } = useTheme();
  // ThemeProvider sets <html data-theme> synchronously, so values are fresh here.
  return useMemo(() => buildChartTheme(), [theme]);
}

/** Series list for flags-by-level stacked charts: [{key, label, color}] */
export function levelSeries(chartTheme, levels = ['MEDIUM', 'HIGH', 'CRITICAL']) {
  return levels.map((l) => ({ key: l, label: LEVEL_META[l].label, color: chartTheme.level[l] }));
}

export function statusSeries(chartTheme) {
  return STATUSES.map((s) => ({ key: s, label: STATUS_META[s].label, color: chartTheme.status[s] }));
}

export default useChartTheme;
