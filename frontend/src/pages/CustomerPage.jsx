import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowLeft,
  Banknote,
  Flag,
  Link2,
  MapPin,
  Network,
  Receipt,
  Smartphone,
  Sigma,
  TrendingUp,
  UserX,
  Users,
  Wallet,
} from 'lucide-react';
import {
  Avatar,
  Button,
  Card,
  ChartTooltip,
  CopyButton,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Pill,
  RiskBadge,
  Skeleton,
  StatCard,
  StatusBadge,
  Tooltip,
} from '../components/ui';
import useApi from '../hooks/useApi';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { useChartTheme } from '../utils/chartTheme';
import { LEVEL_META, FLAG_LEVELS, maxLevel, normalizeLevel } from '../constants/levels';
import { STATUSES } from '../constants/statuses';
import {
  DASH,
  formatDate,
  formatDateTime,
  formatINR,
  formatINRCompact,
  formatNumber,
  formatTime,
  relativeTime,
} from '../utils/format';
import { buildTransactionColumns } from './TransactionsPage';
import '../styles/pages/customer.css';

const DAY_MS = 86400000;

function sumValues(obj) {
  return Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

function FlaggedDot(props) {
  const { cx, cy, payload, levelColors, surface, brand, index } = props;
  const key = `dot-${index}`;
  if (cx == null || cy == null) return <g key={key} />;
  if (payload?.flagged) {
    const color = levelColors[payload.level] || levelColors.MEDIUM;
    return <circle key={key} cx={cx} cy={cy} r={6} fill={color} stroke={surface} strokeWidth={2} />;
  }
  return <circle key={key} cx={cx} cy={cy} r={2.5} fill={brand} stroke="none" />;
}

function SpendingChart({ transactions }) {
  const ct = useChartTheme();
  const points = useMemo(
    () =>
      (transactions || [])
        .map((t) => ({
          t: new Date(t.timestamp).getTime(),
          amount: Number(t.amount) || 0,
          level: normalizeLevel(t.risk_level) || 'LOW',
          flagged: Boolean(t.flag_id),
          id: t.transaction_id,
        }))
        .filter((p) => Number.isFinite(p.t))
        .sort((a, b) => a.t - b.t),
    [transactions]
  );

  if (points.length === 0) {
    return (
      <div className="cust-chart cust-chart--empty">
        <EmptyState icon={TrendingUp} title="No spending yet" description="Transactions will be plotted here." />
      </div>
    );
  }

  const span = points[points.length - 1].t - points[0].t;
  const tickFmt = (v) => (span <= 2 * DAY_MS ? formatTime(v) : formatDate(v));
  const dotProps = { levelColors: ct.level, surface: ct.surface, brand: ct.brand };

  return (
    <div className="cust-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="custSpendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ct.brand} stopOpacity={0.22} />
              <stop offset="100%" stopColor={ct.brand} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...ct.grid} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={tickFmt}
            minTickGap={24}
            {...ct.axis}
          />
          <YAxis tickFormatter={(v) => formatINRCompact(v)} width={64} {...ct.axis} />
          <RTooltip
            cursor={ct.lineCursor}
            content={
              <ChartTooltip
                formatter={(v) => formatINR(v)}
                labelFormatter={(l) => formatDateTime(l)}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="amount"
            name="Amount"
            stroke={ct.brand}
            strokeWidth={2}
            fill="url(#custSpendFill)"
            dot={({ key, ...p }) => <FlaggedDot key={key} {...p} {...dotProps} />}
            activeDot={({ key, ...p }) => <FlaggedDot key={key} {...p} {...dotProps} />}
            isAnimationActive={ct.isAnimationActive}
            animationDuration={ct.animationDuration}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartLegend({ transactions }) {
  const levels = useMemo(() => {
    const present = new Set((transactions || []).filter((t) => t.flag_id).map((t) => normalizeLevel(t.risk_level)));
    return FLAG_LEVELS.filter((l) => present.has(l));
  }, [transactions]);
  if (!levels.length) return null;
  return (
    <span className="cust-legend">
      <span className="cust-legend__label">Flagged</span>
      {levels.map((l) => (
        <span key={l} className="cust-legend__item">
          <span className="cust-legend__dot" style={{ background: LEVEL_META[l].color }} />
          {LEVEL_META[l].label}
        </span>
      ))}
    </span>
  );
}

function LocationsList({ cities }) {
  const sorted = [...(cities || [])].sort((a, b) => b.count - a.count);
  const max = sorted.reduce((m, c) => Math.max(m, c.count), 0) || 1;
  if (!sorted.length) {
    return <p className="cust-empty-line">No locations recorded</p>;
  }
  return (
    <ul className="cust-bars">
      {sorted.map((c) => (
        <li key={c.city || 'unknown'} className="cust-bars__row">
          <span className="cust-bars__label">
            <MapPin size={14} aria-hidden="true" />
            <span className="cust-bars__name">{c.city || 'Unknown'}</span>
          </span>
          <span className="cust-bars__track" aria-hidden="true">
            <span className="cust-bars__fill" style={{ width: `${(c.count / max) * 100}%` }} />
          </span>
          <span className="cust-bars__count tabular-nums">{formatNumber(c.count)}</span>
        </li>
      ))}
    </ul>
  );
}

function DevicesList({ devices }) {
  const sorted = [...(devices || [])].sort(
    (a, b) => (b.customer_count || 0) - (a.customer_count || 0) || b.count - a.count
  );
  if (!sorted.length) return <p className="cust-empty-line">No devices recorded</p>;
  return (
    <ul className="cust-list">
      {sorted.map((d) => {
        const others = (d.customer_count || 0) - 1;
        const shared = (d.customer_count || 0) >= 2;
        return (
          <li key={d.device_id} className={`cust-list__row${shared ? ' is-shared' : ''}`}>
            <span className="cust-list__icon" aria-hidden="true">
              <Smartphone size={14} />
            </span>
            <span className="cust-list__main">
              <Link
                className="cust-link mono nowrap"
                to={`/transactions?device_id=${encodeURIComponent(d.device_id)}`}
              >
                {d.device_id}
              </Link>
              <span className="cust-list__sub tabular-nums">
                {formatNumber(d.count)} {d.count === 1 ? 'transaction' : 'transactions'}
              </span>
            </span>
            {shared ? (
              <Link to="/network" className="cust-pill-link">
                <Pill tone="error" icon={Network}>
                  Shared with {others} {others === 1 ? 'customer' : 'customers'}
                </Pill>
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function LinkedCustomers({ linked }) {
  if (!linked || linked.length === 0) {
    return (
      <div className="cust-linked-empty">
        <Users size={18} aria-hidden="true" />
        <span>No linked customers</span>
      </div>
    );
  }
  return (
    <ul className="cust-list">
      {linked.map((c) => (
        <li key={c.customer_id} className="cust-list__row">
          <Avatar name={c.customer_id} size={28} />
          <span className="cust-list__main">
            <Link className="cust-link mono nowrap" to={`/customers/${encodeURIComponent(c.customer_id)}`}>
              {c.customer_id}
            </Link>
            <span className="cust-via">
              <span className="cust-list__sub">via</span>
              {(c.via_device_ids || []).map((dev) => (
                <Link
                  key={dev}
                  className="cust-chip mono nowrap"
                  to={`/transactions?device_id=${encodeURIComponent(dev)}`}
                >
                  <Smartphone size={12} aria-hidden="true" />
                  {dev}
                </Link>
              ))}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function FlagsSummary({ customerId, byStatus, byLevel }) {
  return (
    <div className="cust-flags">
      <div className="cust-flags__row">
        {STATUSES.map((s) => (
          <Link
            key={s}
            className="cust-flags__item"
            to={`/flags?q=${encodeURIComponent(customerId)}&status=${s}`}
          >
            <StatusBadge status={s} size="sm" />
            <span className="cust-flags__count tabular-nums">{formatNumber(byStatus?.[s] || 0)}</span>
          </Link>
        ))}
      </div>
      <div className="cust-flags__row">
        {FLAG_LEVELS.map((l) => (
          <span key={l} className="cust-flags__item cust-flags__item--static">
            <RiskBadge level={l} size="sm" />
            <span className="cust-flags__count tabular-nums">{formatNumber(byLevel?.[l] || 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function CustomerSkeleton() {
  return (
    <div className="page cust-page" aria-busy="true">
      <PageHeader
        title={
          <span className="cust-title">
            <Skeleton width={40} height={40} radius={999} />
            <Skeleton width={160} height={24} />
          </span>
        }
        description={<Skeleton width={260} height={14} />}
      />
      <div className="cust-kpis">
        {Array.from({ length: 5 }).map((_, i) => (
          <StatCard key={i} label={' '} value={' '} loading />
        ))}
      </div>
      <div className="cust-grid cust-grid--main">
        <Card title="Spending over time">
          <Skeleton height={260} />
        </Card>
        <Card title="Locations">
          <Skeleton height={260} />
        </Card>
      </div>
      <div className="cust-grid cust-grid--three">
        <Card title="Devices">
          <Skeleton height={140} />
        </Card>
        <Card title="Linked customers">
          <Skeleton height={140} />
        </Card>
        <Card title="Flags">
          <Skeleton height={140} />
        </Card>
      </div>
      <Card title="Transactions" padded={false}>
        <DataTable columns={buildTransactionColumns({ showCustomer: false })} rows={[]} loading compact />
      </Card>
    </div>
  );
}

export default function CustomerPage() {
  const { customerId = '' } = useParams();
  const navigate = useNavigate();
  useDocumentTitle(customerId ? `Customer ${customerId}` : 'Customer');

  const { data, error, loading, reload } = useApi(
    customerId ? `/api/customers/${encodeURIComponent(customerId)}` : null
  );

  const columns = useMemo(() => buildTransactionColumns({ showCustomer: false }), []);

  if (error && (error.status === 404 || !data)) {
    if (error.status === 404) {
      return (
        <div className="page cust-page">
          <PageHeader title="Customer" description="Profile, spending and linked accounts" />
          <Card>
            <EmptyState
              icon={UserX}
              title="Customer not found"
              description={`No transactions have been recorded for ${customerId}.`}
              action={
                <Button icon={ArrowLeft} onClick={() => navigate('/transactions')}>
                  Back to transactions
                </Button>
              }
            />
          </Card>
        </div>
      );
    }
    return (
      <div className="page cust-page">
        <PageHeader title="Customer" description="Profile, spending and linked accounts" />
        <Card>
          <ErrorState error={error} onRetry={() => reload()} />
        </Card>
      </div>
    );
  }

  if (!data) return <CustomerSkeleton />;

  const txs = data.transactions || [];
  const highest =
    maxLevel([
      ...txs.map((t) => t.risk_level),
      ...Object.entries(data.flags_by_level || {})
        .filter(([, n]) => n > 0)
        .map(([l]) => l),
    ]) || 'LOW';
  const linked = data.linked_customers || [];
  const totalFlags = sumValues(data.flags_by_status);
  const pending = data.flags_by_status?.PENDING_REVIEW || 0;
  const id = data.customer_id;

  return (
    <div className="page cust-page">
      <PageHeader
        title={
          <span className="cust-title">
            <Avatar name={id} size={40} />
            <span className="mono nowrap">{id}</span>
            <CopyButton value={id} label="Copy customer id" />
            <RiskBadge level={highest} />
            {linked.length > 0 ? (
              <Pill tone="warning" icon={Link2}>
                Linked to {linked.length} {linked.length === 1 ? 'customer' : 'customers'}
              </Pill>
            ) : null}
          </span>
        }
        description={
          <span>
            First seen {formatDate(data.first_seen)} · last active{' '}
            <Tooltip content={formatDateTime(data.last_seen)}>
              <span className="cust-rel">{relativeTime(data.last_seen)}</span>
            </Tooltip>
          </span>
        }
        actions={
          <Button icon={Receipt} onClick={() => navigate(`/transactions?customer_id=${encodeURIComponent(id)}`)}>
            All transactions
          </Button>
        }
      />

      <div className="cust-kpis">
        <StatCard
          label="Transactions"
          value={formatNumber(data.transaction_count)}
          sub={data.first_seen ? `Since ${formatDate(data.first_seen)}` : undefined}
          icon={Receipt}
          to={`/transactions?customer_id=${encodeURIComponent(id)}`}
        />
        <StatCard label="Total spent" value={formatINR(data.total_amount)} icon={Sigma} />
        <StatCard label="Average" value={formatINR(data.average_amount)} sub="Per transaction" icon={Banknote} />
        <StatCard
          label="Latest balance"
          value={data.latest_balance == null ? DASH : formatINR(data.latest_balance)}
          icon={Wallet}
        />
        <StatCard
          label="Flags"
          value={formatNumber(totalFlags)}
          sub={pending > 0 ? `${formatNumber(pending)} need review` : 'None pending'}
          icon={Flag}
          color={totalFlags > 0 ? LEVEL_META[highest]?.color : undefined}
          to={totalFlags > 0 ? `/flags?q=${encodeURIComponent(id)}&status=` : undefined}
        />
      </div>

      <div className="cust-grid cust-grid--main">
        <Card
          title="Spending over time"
          subtitle="Amount per transaction; flagged payments in their risk color"
          actions={<ChartLegend transactions={txs} />}
        >
          <SpendingChart transactions={txs} />
        </Card>
        <Card title="Locations" subtitle="Transactions by city">
          <div className="cust-scroll">
            <LocationsList cities={data.cities} />
          </div>
        </Card>
      </div>

      <div className="cust-grid cust-grid--three">
        <Card title="Devices" subtitle="Shared devices link customers into rings">
          <DevicesList devices={data.devices} />
        </Card>
        <Card title="Linked customers" subtitle="Customers who used the same devices">
          <LinkedCustomers linked={linked} />
        </Card>
        <Card title="Flags" subtitle="By review status and risk level">
          <FlagsSummary customerId={id} byStatus={data.flags_by_status} byLevel={data.flags_by_level} />
        </Card>
      </div>

      <Card
        title="Transactions"
        subtitle={txs.length >= 100 ? 'Latest 100, newest first' : 'Newest first'}
        padded={false}
        actions={
          <Link className="cust-link cust-viewall" to={`/transactions?customer_id=${encodeURIComponent(id)}`}>
            View all
          </Link>
        }
      >
        <DataTable
          columns={columns}
          rows={txs}
          rowKey="transaction_id"
          getRowLevel={(row) => (row.flag_id ? row.risk_level : null)}
          compact
          empty={{ icon: Receipt, title: 'No transactions', description: 'This customer has no transactions yet.' }}
        />
      </Card>
    </div>
  );
}
