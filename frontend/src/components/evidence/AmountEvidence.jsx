import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { Card, ChartTooltip, EmptyState } from '../ui';
import { useChartTheme } from '../../utils/chartTheme';
import { getLevelMeta, normalizeLevel } from '../../constants/levels';
import { formatINR, formatINRCompact, formatNumber, formatDateTime, pluralize } from '../../utils/format';
import '../../styles/pages/evidence.css';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Amount-vs-history evidence card.
 * Props: details (unusual_amount details) or result ({details}), level,
 *        history (FlagDetail.recent_history, newest first; aliases recentHistory / recent_history),
 *        transaction (optional TransactionOut of the flagged txn), currency='INR', height=200.
 */
export default function AmountEvidence({
  details,
  result,
  level,
  history,
  recentHistory,
  recent_history: recentHistorySnake,
  transaction,
  currency,
  height = 200,
  className = '',
}) {
  const d = details || result?.details || {};
  const lvl = normalizeLevel(level) || 'HIGH';
  const meta = getLevelMeta(lvl);
  const t = useChartTheme();
  const cur = currency || transaction?.currency || 'INR';
  const rows = history || recentHistory || recentHistorySnake || [];

  const amount = num(d.amount) ?? num(transaction?.amount);
  const average = num(d.average);
  const multiplier = num(d.multiplier) ?? 3;
  const limit = num(d.new_customer_limit);
  const isNew = d.mode === 'new_customer' || average === null;
  const threshold = isNew ? limit : average * multiplier;
  const ratio = num(d.ratio) ?? (average ? (amount ?? 0) / average : null);
  const historyCount = num(d.history_count) ?? rows.length;

  const data = useMemo(() => {
    const past = rows
      .slice(0, 10)
      .slice()
      .reverse()
      .map((r, i) => ({
        key: r.transaction_id || `h${i}`,
        label: r.transaction_id || `#${i + 1}`,
        amount: num(r.amount) ?? 0,
        time: r.timestamp,
        flagged: false,
      }));
    if (amount !== null) {
      past.push({
        key: transaction?.transaction_id || 'current',
        label: transaction?.transaction_id || 'This',
        amount,
        time: transaction?.timestamp,
        flagged: true,
      });
    }
    return past;
  }, [rows, amount, transaction]);

  const caption = isNew
    ? `Only ${pluralize(historyCount, 'previous transaction')}; ${formatINR(amount, cur)} ${
        limit !== null && amount >= limit ? 'exceeds' : 'is below'
      } the new-customer limit of ${formatINR(limit, cur)}.`
    : `${formatINR(amount, cur)} is ${formatNumber(ratio, 1)}× this customer's average of ${formatINR(
        average,
        cur
      )} (threshold: ${formatNumber(multiplier, 1)}×).`;

  const refLabel = isNew ? 'New-customer limit' : `${formatNumber(multiplier, 1)}× avg`;
  const byKey = useMemo(() => Object.fromEntries(data.map((r) => [r.label, r])), [data]);

  return (
    <Card
      title="Amount vs history"
      subtitle={isNew ? 'New customer — compared with the new-customer limit' : `Last ${pluralize(data.length - 1, 'transaction')} and this payment`}
      icon={BarChart3}
      className={`ev-card ${className}`.trim()}
      style={{ '--ev-level': meta.color, '--ev-level-soft': meta.soft, '--ev-level-on-soft': meta.onSoft }}
    >
      {data.length === 0 ? (
        <EmptyState title="No amounts to compare" description="This transaction has no amount history." />
      ) : (
        <figure className="ev-chart" aria-label={caption} role="img" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid {...t.grid} />
              <XAxis
                dataKey="label"
                {...t.axis}
                tick={{ ...t.tick, fontFamily: t.monoFamily, fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={4}
              />
              <YAxis {...t.axis} width={56} tickFormatter={(v) => formatINRCompact(v, cur)} />
              <Tooltip
                cursor={t.cursor}
                content={
                  <ChartTooltip
                    formatter={(v) => formatINR(v, cur)}
                    labelFormatter={(l) => {
                      const row = byKey[l];
                      if (!row) return l;
                      const when = row.time ? ` · ${formatDateTime(row.time)}` : '';
                      return `${row.flagged ? 'Flagged payment' : l}${when}`;
                    }}
                  />
                }
              />
              {threshold !== null && Number.isFinite(threshold) && (
                <ReferenceLine
                  y={threshold}
                  stroke={t.text2}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                  label={{
                    value: `${refLabel} ${formatINRCompact(threshold, cur)}`,
                    position: 'insideTopLeft',
                    fill: t.text2,
                    fontSize: 11,
                    fontFamily: t.fontFamily,
                  }}
                />
              )}
              <Bar
                dataKey="amount"
                name="Amount"
                radius={t.barRadius}
                maxBarSize={28}
                isAnimationActive={t.isAnimationActive}
                animationDuration={t.animationDuration}
              >
                {data.map((row) => (
                  <Cell
                    key={row.key}
                    fill={row.flagged ? t.level[lvl] : t.text3}
                    fillOpacity={row.flagged ? 1 : 0.35}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </figure>
      )}
      <p className="ev-caption">
        <span className="ev-caption__swatch" aria-hidden="true" />
        {caption}
      </p>
    </Card>
  );
}
