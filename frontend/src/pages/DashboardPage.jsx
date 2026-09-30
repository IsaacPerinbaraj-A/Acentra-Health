import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LabelList,
} from 'recharts';
import {
  ArrowLeftRight,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock,
  Database,
  Network,
  RefreshCw,
  ShieldAlert,
  Siren,
} from 'lucide-react';

import {
  Button,
  Card,
  ChartTooltip,
  EmptyState,
  ErrorState,
  PageHeader,
  RiskBadge,
  RuleChip,
  Skeleton,
  StatCard,
  Tooltip,
} from '../components/ui';
import useApi from '../hooks/useApi';
import usePolling from '../hooks/usePolling';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { useAuth } from '../auth/AuthContext';
import {
  formatDateTime,
  formatDuration,
  formatINR,
  formatNumber,
  formatPercent,
  parseDate,
  relativeTime,
} from '../utils/format';
import { useChartTheme } from '../utils/chartTheme';
import { FLAG_LEVELS, LEVEL_META, levelGte } from '../constants/levels';
import { STATUSES, STATUS_META } from '../constants/statuses';
import { getRuleMeta, ruleNameFromDisplayName } from '../constants/ruleMeta';
import '../styles/pages/dashboard.css';

const POLL_MS = 30000;
const CHART_HEIGHT = 260;
const PENDING_QUERY = { status: 'PENDING_REVIEW', sort: 'priority', page_size: 5 };

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function bucketTick(value, bucket) {
  const d = parseDate(value);
  if (!d) return String(value ?? '');
  if (bucket === 'hour') {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function bucketLabel(value, bucket) {
  const d = parseDate(value);
  if (!d) return String(value ?? '');
  if (bucket === 'hour') {
    return d.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function waitingTone(minutes, level) {
  if (minutes == null || !levelGte(level, 'HIGH')) return '';
  if (minutes >= 240) return 'is-error';
  if (minutes >= 60) return 'is-warning';
  return '';
}

/* ------------------------------------------------------------------ */
/* charts                                                              */
/* ------------------------------------------------------------------ */

function FlagsOverTimeChart({ stats, t }) {
  const bucket = stats.bucket || 'hour';
  const data = useMemo(
    () =>
      (stats.flags_over_time || []).map((row) => {
        const entry = { bucket: row.bucket };
        let top = null;
        FLAG_LEVELS.forEach((l) => {
          entry[l] = num(row[l]);
          if (entry[l] > 0) top = l;
        });
        entry.__top = top;
        return entry;
      }),
    [stats.flags_over_time]
  );

  if (!data.length) {
    return (
      <div className="dash-chart dash-chart--empty">
        <span>No flags in this period</span>
      </div>
    );
  }

  return (
    <div className="dash-chart" role="img" aria-label="Stacked bar chart of flags over time by risk level">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }} barCategoryGap="28%">
          <CartesianGrid {...t.grid} />
          <XAxis
            dataKey="bucket"
            {...t.axis}
            tickFormatter={(v) => bucketTick(v, bucket)}
            minTickGap={16}
          />
          <YAxis {...t.axis} allowDecimals={false} width={48} />
          <ChartTip
            cursor={t.cursor}
            content={<ChartTooltip labelFormatter={(l) => bucketLabel(l, bucket)} />}
          />
          <Legend {...t.legend} />
          {FLAG_LEVELS.map((l) => (
            <Bar
              key={l}
              dataKey={l}
              name={LEVEL_META[l].label}
              stackId="levels"
              fill={t.level[l]}
              maxBarSize={36}
              isAnimationActive={t.isAnimationActive}
              animationDuration={t.animationDuration}
            >
              {data.map((row, i) => (
                <Cell key={i} fill={t.level[l]} radius={row.__top === l ? t.barRadius : 0} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RiskMixChart({ stats, t }) {
  const byLevel = stats.flags_by_level || {};
  const rows = FLAG_LEVELS.map((l) => ({
    key: l,
    name: LEVEL_META[l].label,
    value: num(byLevel[l]),
    color: t.level[l],
  }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  const slices = rows.filter((r) => r.value > 0);

  return (
    <div className="dash-donut">
      <div className="dash-donut-chart" role="img" aria-label={`Risk mix donut: ${total} flags`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {total > 0 ? (
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius="68%"
                outerRadius="92%"
                paddingAngle={slices.length > 1 ? 2 : 0}
                cornerRadius={4}
                stroke={t.surface}
                strokeWidth={2}
                startAngle={90}
                endAngle={-270}
                isAnimationActive={t.isAnimationActive}
                animationDuration={t.animationDuration}
              >
                {slices.map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
            ) : (
              <Pie
                data={[{ name: 'None', value: 1 }]}
                dataKey="value"
                innerRadius="68%"
                outerRadius="92%"
                stroke="none"
                fill={t.surface2}
                isAnimationActive={false}
              />
            )}
            {total > 0 && <ChartTip content={<ChartTooltip />} />}
          </PieChart>
        </ResponsiveContainer>
        <div className="dash-donut-center" aria-hidden="true">
          <span className="dash-donut-total">{formatNumber(total)}</span>
          <span className="dash-donut-caption">{total === 1 ? 'flag' : 'flags'}</span>
        </div>
      </div>
      <ul className="dash-legend">
        {rows.map((r) => (
          <li key={r.key} className="dash-legend-row">
            <span className="dash-legend-swatch" style={{ background: LEVEL_META[r.key].color }} />
            <span className="dash-legend-label">{r.name}</span>
            <span className="dash-legend-value">{formatNumber(r.value)}</span>
            <span className="dash-legend-pct">{total ? formatPercent(r.value / total) : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RulesFiringChart({ stats, t }) {
  const data = useMemo(
    () =>
      (stats.rule_fire_counts || [])
        .map((r) => {
          const meta = getRuleMeta(r.rule_name, r.display_name);
          return { rule_name: r.rule_name, label: meta.displayName, count: num(r.count) };
        })
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    [stats.rule_fire_counts]
  );
  const height = Math.max(CHART_HEIGHT, data.length * 38 + 16);

  if (!data.length) {
    return (
      <div className="dash-chart dash-chart--empty">
        <span>No rules loaded</span>
      </div>
    );
  }

  return (
    <div className="dash-chart" style={{ height }} role="img" aria-label="Horizontal bar chart of rule fire counts">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid {...t.grid} vertical={false} horizontal={false} />
          <XAxis type="number" {...t.axis} allowDecimals={false} hide />
          <YAxis type="category" dataKey="label" {...t.axis} width={184} interval={0} />
          <ChartTip cursor={t.cursor} content={<ChartTooltip formatter={(v) => `${formatNumber(v)} fired`} />} />
          <Bar
            dataKey="count"
            name="Times fired"
            radius={t.barRadiusHorizontal}
            maxBarSize={18}
            isAnimationActive={t.isAnimationActive}
            animationDuration={t.animationDuration}
          >
            {data.map((d) => (
              <Cell key={d.rule_name} fill={t.rule(d.rule_name)} />
            ))}
            <LabelList dataKey="count" position="right" fill={t.text2} fontSize={12} offset={8} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ReviewStatusChart({ stats, t }) {
  const byStatus = stats.flags_by_status || {};
  const data = STATUSES.map((s) => ({ key: s, label: STATUS_META[s].label, count: num(byStatus[s]) }));

  return (
    <div className="dash-chart" role="img" aria-label="Bar chart of flags by review status">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 4, bottom: 0, left: -16 }} barCategoryGap="30%">
          <CartesianGrid {...t.grid} />
          <XAxis dataKey="label" {...t.axis} interval={0} />
          <YAxis {...t.axis} allowDecimals={false} width={48} />
          <ChartTip cursor={t.cursor} content={<ChartTooltip />} />
          <Bar
            dataKey="count"
            name="Flags"
            radius={t.barRadius}
            maxBarSize={48}
            isAnimationActive={t.isAnimationActive}
            animationDuration={t.animationDuration}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={t.status[d.key]} />
            ))}
            <LabelList dataKey="count" position="top" fill={t.text2} fontSize={12} offset={6} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* needs attention                                                     */
/* ------------------------------------------------------------------ */

function PendingRow({ flag }) {
  const tx = flag.transaction || {};
  const names = flag.fired_rule_names || [];
  const labels = flag.fired_rules || [];
  const rules = (names.length ? names : labels.map(ruleNameFromDisplayName)).map((name, i) => ({
    name,
    label: labels[i] || getRuleMeta(name).displayName,
  }));
  const shown = rules.slice(0, 3);
  const extra = rules.slice(3);

  return (
    <li>
      <Link to={`/flags/${flag.id}`} className="dash-attn-row">
        <span className="dash-attn-level">
          <RiskBadge level={flag.risk_level} size="sm" />
        </span>
        <span className="dash-attn-id mono">{tx.transaction_id || `#${flag.id}`}</span>
        <span className="dash-attn-customer mono">{tx.customer_id || '—'}</span>
        <span className="dash-attn-amount">{formatINR(tx.amount, tx.currency)}</span>
        <span className="dash-attn-rules">
          {shown.map((r) => (
            <RuleChip key={r.name} name={r.name} label={r.label} />
          ))}
          {extra.length > 0 && (
            <Tooltip content={extra.map((r) => r.label).join(', ')}>
              <span className="dash-attn-more">+{extra.length}</span>
            </Tooltip>
          )}
        </span>
        <span className={`dash-attn-wait ${waitingTone(flag.waiting_minutes, flag.risk_level)}`}>
          <Tooltip content={`Flagged ${formatDateTime(flag.created_at)}`}>
            <span className="dash-attn-wait-inner">
              <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
              {flag.waiting_minutes != null ? formatDuration(flag.waiting_minutes) : relativeTime(flag.created_at)}
            </span>
          </Tooltip>
        </span>
      </Link>
    </li>
  );
}

function NeedsAttention({ pending, loading }) {
  const items = pending.data?.items || [];
  const total = pending.data?.total ?? 0;

  let body;
  if (loading || (pending.loading && !pending.data)) {
    body = (
      <ul className="dash-attn-list" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="dash-attn-row dash-attn-row--skeleton">
            <Skeleton width={72} height={20} radius={999} />
            <Skeleton width={56} height={14} />
            <Skeleton width={64} height={14} />
            <Skeleton width={72} height={14} />
            <Skeleton width="60%" height={20} radius={999} />
            <Skeleton width={56} height={14} />
          </li>
        ))}
      </ul>
    );
  } else if (pending.error && !pending.data) {
    body = <ErrorState error={pending.error} onRetry={() => pending.reload()} title="Couldn't load pending flags" />;
  } else if (!items.length) {
    body = (
      <EmptyState
        icon={CheckCircle2}
        tone="success"
        title="Queue cleared"
        description="No flags need review right now."
      />
    );
  } else {
    body = (
      <ul className="dash-attn-list">
        {items.map((f) => (
          <PendingRow key={f.id} flag={f} />
        ))}
      </ul>
    );
  }

  return (
    <Card
      title="Needs attention"
      subtitle={
        total > items.length
          ? `Top ${items.length} of ${formatNumber(total)} pending flags by priority`
          : 'Highest-priority flags waiting for review'
      }
      actions={
        <Link to="/flags" className="dash-link">
          Open queue <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      }
    >
      {body}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

function ChartCard({ title, subtitle, loading, height = CHART_HEIGHT, children }) {
  return (
    <Card title={title} subtitle={subtitle}>
      {loading ? <Skeleton width="100%" height={height} radius={6} /> : children}
    </Card>
  );
}

export default function DashboardPage() {
  useDocumentTitle('Dashboard');
  const navigate = useNavigate();
  const { isAdmin, hasRole } = useAuth();
  const admin = isAdmin ?? hasRole?.('ADMIN');
  const t = useChartTheme();

  const stats = useApi('/api/stats');
  const pending = useApi('/api/flags', { query: PENDING_QUERY });
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    if (stats.data) setUpdatedAt(new Date());
  }, [stats.data]);

  const statsReload = stats.reload;
  const pendingReload = pending.reload;
  const refresh = useCallback(
    (silent) => Promise.all([statsReload({ silent }), pendingReload({ silent })]),
    [statsReload, pendingReload]
  );
  usePolling(() => refresh(true), POLL_MS);

  const [manual, setManual] = useState(false);
  const onRefresh = async () => {
    setManual(true);
    try {
      await refresh(false);
    } finally {
      setManual(false);
    }
  };

  const data = stats.data;
  const loading = !data && !stats.error;

  const header = (
    <PageHeader
      title="Dashboard"
      description="Screening overview: flags, review workload and rule activity, refreshed every 30 seconds."
      actions={
        <div className="dash-header-actions">
          {updatedAt && (
            <Tooltip content={formatDateTime(updatedAt)}>
              <span className="dash-updated">Updated {relativeTime(updatedAt)}</span>
            </Tooltip>
          )}
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={manual} onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      }
    />
  );

  if (stats.error && !data) {
    return (
      <div className="dash">
        {header}
        <ErrorState error={stats.error} onRetry={() => stats.reload()} title="Couldn't load dashboard" />
      </div>
    );
  }

  if (data && num(data.total_transactions) === 0) {
    return (
      <div className="dash">
        {header}
        <Card>
          <EmptyState
            icon={Database}
            tone="brand"
            title="No transactions yet"
            description={
              admin
                ? 'Load demo data to get started, or import a CSV of transactions.'
                : 'Nothing has been screened yet. Ask an admin to load demo data or import transactions.'
            }
            action={
              admin ? (
                <Button variant="primary" icon={Database} onClick={() => navigate('/data')}>
                  Load demo data to get started
                </Button>
              ) : null
            }
          />
        </Card>
      </div>
    );
  }

  const s = data || {};
  const byLevel = s.flags_by_level || {};
  const totalTx = num(s.total_transactions);
  const totalFlags = num(s.total_flags);
  const pendingCount = num(s.pending_review);
  const critical = num(byLevel.CRITICAL);
  const levelSub = FLAG_LEVELS.map((l) => `${formatNumber(num(byLevel[l]))} ${LEVEL_META[l].label.toLowerCase()}`).join(
    ' · '
  );

  const cards = [
    {
      key: 'tx',
      label: 'Transactions',
      value: formatNumber(totalTx),
      sub: totalTx ? `${formatPercent(totalFlags / totalTx)} flagged` : 'None screened yet',
      icon: ArrowLeftRight,
      color: 'var(--brand)',
      to: '/transactions',
    },
    {
      key: 'flagged',
      label: 'Flagged',
      value: formatNumber(totalFlags),
      sub: levelSub,
      icon: ShieldAlert,
      color: 'var(--level-high)',
      to: '/flags?tab=all',
    },
    {
      key: 'pending',
      label: 'Needs review',
      value: formatNumber(pendingCount),
      sub: pendingCount ? `${formatPercent(totalFlags ? pendingCount / totalFlags : 0)} of flags` : 'Queue cleared',
      icon: Clock,
      color: 'var(--status-pending-review)',
      to: '/flags',
    },
    {
      key: 'alerts',
      label: 'Alerts sent',
      value: formatNumber(num(s.alerts_sent)),
      sub: 'High and critical flags',
      icon: BellRing,
      color: 'var(--level-medium)',
      to: admin ? '/alerts' : undefined,
    },
    {
      key: 'critical',
      label: 'Critical',
      value: formatNumber(critical),
      sub: 'Score 75 and above',
      icon: Siren,
      color: 'var(--level-critical)',
      to: '/flags?tab=all&level=CRITICAL',
    },
    {
      key: 'rings',
      label: 'Fraud rings',
      value: formatNumber(num(s.fraud_rings)),
      sub: 'Devices shared by 3+ customers',
      icon: Network,
      color: 'var(--status-reviewed)',
      to: '/network',
    },
  ];

  return (
    <div className="dash">
      {header}

      <section className="dash-kpis" aria-label="Key metrics">
        {cards.map((c) => (
          <StatCard
            key={c.key}
            label={c.label}
            value={c.value}
            sub={c.sub}
            icon={c.icon}
            color={c.color}
            to={c.to}
            loading={loading}
          />
        ))}
      </section>

      <section className="dash-grid dash-grid--wide">
        <ChartCard
          title="Flags over time"
          subtitle={s.bucket === 'day' ? 'Flags per day by risk level' : 'Flags per hour by risk level'}
          loading={loading}
        >
          <FlagsOverTimeChart stats={s} t={t} />
        </ChartCard>
        <ChartCard title="Risk mix" subtitle="Flags by risk level" loading={loading}>
          <RiskMixChart stats={s} t={t} />
        </ChartCard>
      </section>

      <section className="dash-grid dash-grid--half">
        <ChartCard title="Rules firing" subtitle="Times each rule fired across all transactions" loading={loading}>
          <RulesFiringChart stats={s} t={t} />
        </ChartCard>
        <ChartCard title="Review status" subtitle="Flags by review outcome" loading={loading}>
          <ReviewStatusChart stats={s} t={t} />
        </ChartCard>
      </section>

      <NeedsAttention pending={pending} loading={loading} />
    </div>
  );
}
