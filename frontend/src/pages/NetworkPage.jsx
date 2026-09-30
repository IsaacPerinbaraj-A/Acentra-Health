import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Network, RefreshCw } from 'lucide-react';
import {
  Button,
  Card,
  CopyButton,
  DataTable,
  DateRange,
  EmptyState,
  ErrorState,
  FilterBar,
  IconButton,
  NumberInput,
  PageHeader,
  Pill,
  RiskBadge,
  Skeleton,
  SkeletonRows,
  Switch,
  Tooltip,
} from '../components/ui';
import NetworkGraph from '../components/NetworkGraph';
import useApi from '../hooks/useApi';
import useUrlState from '../hooks/useUrlState';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { levelRank } from '../constants/levels';
import { formatDateTime, formatNumber, relativeTime, toApiDateTime } from '../utils/format';
import '../styles/pages/network.css';

const DEFAULTS = { min: 2, from: '', to: '', rings: false };

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function clusterTitle(cluster) {
  const shared = (cluster.devices || []).filter((d) => d.is_shared);
  const n = (cluster.customers || []).length;
  if (cluster.is_ring && shared.length) {
    if (shared.length === 1) {
      const d = shared[0];
      return `Fraud ring — device ${d.device_id} shared by ${plural(d.customer_count ?? n, 'customer')}`;
    }
    return `Fraud ring — devices ${shared.map((d) => d.device_id).join(', ')} shared by ${plural(n, 'customer')}`;
  }
  const devs = cluster.devices || [];
  return `${plural(n, 'customer')} linked by ${devs.length === 1 ? 'device' : 'devices'} ${devs
    .map((d) => d.device_id)
    .join(', ')}`;
}

function LegendItem({ children, label }) {
  return (
    <span className="net-legend__item">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        {children}
      </svg>
      {label}
    </span>
  );
}

function Legend() {
  return (
    <div className="net-legend" aria-label="Legend">
      <LegendItem label="Customer (colored by highest risk level)">
        <circle cx="10" cy="10" r="7" className="net-legend__customer" />
      </LegendItem>
      <LegendItem label="Device">
        <rect x="3" y="3" width="14" height="14" rx="4" className="net-legend__device" />
      </LegendItem>
      <LegendItem label="Shared device">
        <rect x="3" y="3" width="14" height="14" rx="4" className="net-legend__device net-legend__device--shared" />
      </LegendItem>
      <LegendItem label="Line thickness = transactions">
        <line x1="2" y1="6" x2="18" y2="6" className="net-legend__edge" strokeWidth="1.5" />
        <line x1="2" y1="14" x2="18" y2="14" className="net-legend__edge" strokeWidth="4" />
      </LegendItem>
    </div>
  );
}

function ClusterCard({ cluster }) {
  const lastSeenByCustomer = useMemo(() => {
    const m = new Map();
    (cluster.edges || []).forEach((e) => {
      const prev = m.get(e.customer_id);
      if (e.last_seen && (!prev || e.last_seen > prev)) m.set(e.customer_id, e.last_seen);
    });
    return m;
  }, [cluster]);

  const rows = useMemo(
    () =>
      [...(cluster.customers || [])].sort(
        (a, b) =>
          levelRank(b.max_level) - levelRank(a.max_level) ||
          String(a.customer_id).localeCompare(String(b.customer_id))
      ),
    [cluster]
  );

  const columns = [
    {
      key: 'customer_id',
      header: 'Customer',
      mono: true,
      nowrap: true,
      render: (r) => (
        <Link
          className="net-id-link"
          to={`/customers/${encodeURIComponent(r.customer_id)}`}
          onClick={(e) => e.stopPropagation()}
        >
          {r.customer_id}
        </Link>
      ),
    },
    {
      key: 'transaction_count',
      header: 'Transactions',
      align: 'right',
      render: (r) => <span className="net-num">{formatNumber(r.transaction_count)}</span>,
    },
    {
      key: 'flag_count',
      header: 'Flags',
      align: 'right',
      render: (r) => <span className="net-num">{formatNumber(r.flag_count)}</span>,
    },
    {
      key: 'last_seen',
      header: 'Last seen',
      nowrap: true,
      render: (r) => {
        const ts = lastSeenByCustomer.get(r.customer_id);
        if (!ts) return <span className="net-muted">—</span>;
        return (
          <Tooltip content={formatDateTime(ts)}>
            <span className="net-muted">{relativeTime(ts)}</span>
          </Tooltip>
        );
      },
    },
    {
      key: 'max_level',
      header: 'Max level',
      align: 'right',
      render: (r) => <RiskBadge level={r.max_level} size="sm" />,
    },
  ];

  const devices = cluster.devices || [];

  return (
    <Card
      className={`net-card${cluster.is_ring ? ' net-card--ring' : ''}`}
      title={
        <span className="net-card__title">
          <Pill tone={cluster.is_ring ? 'error' : 'neutral'} icon={Network}>
            {cluster.is_ring ? 'Fraud ring' : 'Linked customers'}
          </Pill>
          <span className="net-card__title-text">{clusterTitle(cluster)}</span>
        </span>
      }
      subtitle={
        <span className="net-card__devices">
          {devices.map((d) => (
            <span key={d.device_id} className={`net-device-id${d.is_shared ? ' is-shared' : ''}`}>
              <span className="net-mono">{d.device_id}</span>
              <CopyButton value={d.device_id} label={`Copy ${d.device_id}`} />
            </span>
          ))}
        </span>
      }
      actions={<RiskBadge level={cluster.max_level} />}
    >
      <div className="net-card__graph">
        <NetworkGraph cluster={cluster} height={360} />
      </div>
      <div className="net-card__table">
        <DataTable columns={columns} rows={rows} rowKey="customer_id" compact />
      </div>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card
      className="net-card"
      title={<Skeleton width={280} height={20} />}
      subtitle={<Skeleton width={120} height={14} />}
      actions={<Skeleton width={64} height={22} radius={999} />}
    >
      <div className="net-card__graph">
        <Skeleton width="100%" height={360} radius={8} />
      </div>
      <div className="net-card__table">
        <SkeletonRows rows={4} columns={5} />
      </div>
    </Card>
  );
}

export default function NetworkPage() {
  useDocumentTitle('Network');
  const [filters, setFilters] = useUrlState(DEFAULTS);
  const minCustomers = Math.max(2, Number(filters.min) || 2);

  const query = useMemo(
    () => ({
      min_customers: minCustomers,
      from: filters.from ? toApiDateTime(filters.from) : undefined,
      to: filters.to ? toApiDateTime(filters.to, true) : undefined,
    }),
    [minCustomers, filters.from, filters.to]
  );

  const { data, error, loading, refreshing, reload } = useApi('/api/network', { query });

  const clusters = useMemo(() => {
    const list = [...(data?.clusters || [])];
    list.sort(
      (a, b) =>
        Number(!!b.is_ring) - Number(!!a.is_ring) ||
        (b.customers?.length || 0) - (a.customers?.length || 0)
    );
    return filters.rings ? list.filter((c) => c.is_ring) : list;
  }, [data, filters.rings]);

  const totalClusters = data?.total_clusters ?? data?.clusters?.length ?? 0;
  const ringCount = (data?.clusters || []).filter((c) => c.is_ring).length;
  const threshold = data?.threshold ?? 3;
  const hasActive = minCustomers !== 2 || !!filters.from || !!filters.to || filters.rings;

  let body;
  if (error && !data) {
    body = (
      <Card>
        <ErrorState error={error} onRetry={() => reload()} />
      </Card>
    );
  } else if (loading && !data) {
    body = (
      <div className="net-grid">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  } else if (!clusters.length) {
    body = (
      <Card>
        <EmptyState
          icon={Network}
          title="No linked customers found."
          description={
            filters.rings
              ? 'No fraud rings match these filters. Turn off "Rings only" or widen the date range.'
              : 'No customers share a device with these filters. Try a lower minimum or a wider date range.'
          }
          action={
            hasActive ? (
              <Button variant="secondary" onClick={() => setFilters.reset()}>
                Clear filters
              </Button>
            ) : null
          }
        />
      </Card>
    );
  } else {
    body = (
      <div className={`net-grid${refreshing ? ' is-refreshing' : ''}`}>
        {clusters.map((c) => (
          <ClusterCard key={c.id ?? c.devices?.map((d) => d.device_id).join('-')} cluster={c} />
        ))}
      </div>
    );
  }

  return (
    <div className="net-page">
      <PageHeader
        title="Network"
        description="Customers linked by shared devices"
        actions={
          <IconButton
            icon={RefreshCw}
            label="Refresh"
            onClick={() => reload()}
            disabled={loading || refreshing}
          />
        }
      />

      <FilterBar hasActive={hasActive} onClear={() => setFilters.reset()}>
        <div className="net-control net-control--min">
          <NumberInput
            label="Min customers"
            value={minCustomers}
            min={2}
            max={50}
            step={1}
            onChange={(v) => setFilters({ min: Math.max(2, Math.min(50, Number(v) || 2)) })}
          />
        </div>
        <DateRange
          from={filters.from}
          to={filters.to}
          onChange={({ from, to }) => setFilters({ from: from || '', to: to || '' })}
        />
        <Switch checked={filters.rings} onChange={(v) => setFilters({ rings: !!v })} label="Rings only" />
      </FilterBar>

      <div className="net-meta">
        <div className="net-summary" aria-live="polite">
          {data ? (
            <>
              <strong>{plural(totalClusters, 'cluster')}</strong>, <strong>{plural(ringCount, 'fraud ring')}</strong>{' '}
              <span className="net-muted">(threshold: {threshold} customers per device)</span>
            </>
          ) : error ? (
            <span className="net-muted">Summary unavailable</span>
          ) : (
            <Skeleton width={320} height={16} />
          )}
        </div>
        <Legend />
      </div>

      {error && data ? (
        <div className="net-inline-error">
          <ErrorState error={error} onRetry={() => reload()} title="Could not refresh the network" />
        </div>
      ) : null}

      {body}
    </div>
  );
}
