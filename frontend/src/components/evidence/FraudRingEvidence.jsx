import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Network, ArrowRight, RotateCw } from 'lucide-react';
import { Card, Skeleton, ErrorState, Pill } from '../ui';
import NetworkGraph from '../NetworkGraph';
import useApi from '../../hooks/useApi';
import { getLevelMeta, normalizeLevel } from '../../constants/levels';
import { pluralize } from '../../utils/format';
import '../../styles/pages/evidence.css';

function buildSyntheticCluster(d, customerId, level) {
  const ids = Array.isArray(d.customer_ids) ? d.customer_ids : [];
  if (!d.device_id || ids.length === 0) return null;
  return {
    id: `synthetic-${d.device_id}`,
    is_ring: true,
    max_level: level,
    customers: ids.map((id) => ({
      customer_id: id,
      transaction_count: 1,
      flag_count: id === customerId ? 1 : 0,
      max_level: id === customerId ? level : 'LOW',
    })),
    devices: [
      {
        device_id: d.device_id,
        customer_count: d.customer_count ?? ids.length,
        transaction_count: ids.length,
        is_shared: true,
      },
    ],
    edges: ids.map((id) => ({ customer_id: id, device_id: d.device_id, transaction_count: 1, last_seen: null })),
  };
}

/**
 * Fraud-ring evidence card (shared_device rule).
 * Props: details (shared_device details) or result ({details}), level,
 *        customerId (flagged customer; falls back to transaction.customer_id), transaction, graphHeight=260.
 */
export default function FraudRingEvidence({
  details,
  result,
  level,
  customerId,
  transaction,
  graphHeight = 260,
  className = '',
}) {
  const d = details || result?.details || {};
  const lvl = normalizeLevel(level) || 'MEDIUM';
  const meta = getLevelMeta(lvl);
  const navigate = useNavigate();
  const cid = customerId || transaction?.customer_id || null;
  const { data, error, loading, reload } = useApi('/api/network', { query: { min_customers: 2 } });

  const synthetic = useMemo(() => buildSyntheticCluster(d, cid, lvl), [d, cid, lvl]);
  const cluster = useMemo(() => {
    const clusters = data?.clusters || [];
    return clusters.find((c) => (c.devices || []).some((dev) => dev.device_id === d.device_id)) || null;
  }, [data, d.device_id]);

  const shown = cluster || (!loading ? synthetic : null);
  const count = d.customer_count ?? d.customer_ids?.length ?? 0;
  const lookback = d.lookback_days ?? 30;
  const subtitle = `Device ${d.device_id || 'unknown'} used by ${pluralize(count, 'customer')} in the last ${pluralize(
    lookback,
    'day'
  )}`;

  const openCustomer = (id) => {
    if (id) navigate(`/customers/${encodeURIComponent(id)}`);
  };

  let body;
  if (loading && !data) {
    body = <Skeleton height={graphHeight} radius="var(--radius-md)" />;
  } else if (error && !synthetic) {
    body = <ErrorState error={error} onRetry={reload} title="Couldn't load the device network" />;
  } else if (!shown) {
    body = (
      <div className="ev-empty" style={{ minHeight: graphHeight }}>
        No linked customers found for device <span className="ev-mono">{d.device_id || '—'}</span>.
      </div>
    );
  } else {
    body = (
      <>
        {error && (
          <div className="ev-inline-note" role="status">
            Live network unavailable — showing customers recorded by the rule.
            <button type="button" className="ev-inline-btn" onClick={() => reload()}>
              <RotateCw size={14} strokeWidth={1.75} aria-hidden="true" />
              Retry
            </button>
          </div>
        )}
        <div className="ev-graph">
          <NetworkGraph
            cluster={shown}
            height={graphHeight}
            compact
            highlightCustomerId={cid}
            onCustomerClick={openCustomer}
          />
        </div>
      </>
    );
  }

  const ids = (shown?.customers || []).map((c) => c.customer_id);
  const listIds = ids.length ? ids : d.customer_ids || [];

  return (
    <Card
      title="Fraud ring"
      subtitle={subtitle}
      icon={Network}
      className={`ev-card ${className}`.trim()}
      style={{ '--ev-level': meta.color, '--ev-level-soft': meta.soft, '--ev-level-on-soft': meta.onSoft }}
      actions={
        <Link to="/network" className="ev-link">
          Open network view
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      }
    >
      {body}
      {listIds.length > 0 && (
        <div className="ev-ring-footer">
          <Pill tone="error">{`${pluralize(count, 'customer')} · threshold ${d.threshold ?? 3}`}</Pill>
          <ul className="ev-ring-ids" aria-label="Customers on this device">
            {listIds.map((id) => (
              <li key={id}>
                <Link
                  to={`/customers/${encodeURIComponent(id)}`}
                  className={`ev-id-link${id === cid ? ' is-current' : ''}`}
                  aria-current={id === cid ? 'true' : undefined}
                >
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
