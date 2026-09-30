import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLevelMeta, levelLabel } from '../constants/levels';
import '../styles/pages/network.css';

const CUSTOMER_R = 16;
const DEVICE_SIZE = 28;

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Deterministic layout: devices on a horizontal line in the centre, customers evenly
 * spaced on an ellipse around them (ordered by the device they use, to limit crossings).
 */
function computeLayout(cluster, width, height, compact) {
  const customers = cluster?.customers || [];
  const devices = [...(cluster?.devices || [])].sort((a, b) =>
    String(a.device_id).localeCompare(String(b.device_id))
  );
  const edges = cluster?.edges || [];

  const top = CUSTOMER_R + 8;
  const bottom = height - (CUSTOMER_R + (compact ? 20 : 24));
  const cy = (top + bottom) / 2;
  const cx = width / 2;
  const rx = width / 2 - (CUSTOMER_R + 26);
  const ry = Math.max(40, (bottom - top) / 2);

  const devIndex = new Map(devices.map((d, i) => [d.device_id, i]));
  const n = devices.length;
  const maxSpan = rx * 1.1;
  const spacing = n > 1 ? Math.min(compact ? 64 : 76, maxSpan / (n - 1)) : 0;
  const devicePos = new Map();
  devices.forEach((d, i) => {
    devicePos.set(d.device_id, { x: cx + (i - (n - 1) / 2) * spacing, y: cy });
  });

  // order customers by the mean index of their devices, then by id
  const custDevs = new Map();
  edges.forEach((e) => {
    if (!custDevs.has(e.customer_id)) custDevs.set(e.customer_id, []);
    const idx = devIndex.get(e.device_id);
    if (idx !== undefined) custDevs.get(e.customer_id).push(idx);
  });
  const orderKey = (c) => {
    const list = custDevs.get(c.customer_id) || [];
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  };
  const ordered = [...customers].sort(
    (a, b) => orderKey(a) - orderKey(b) || String(a.customer_id).localeCompare(String(b.customer_id))
  );

  const m = ordered.length;
  const customerPos = new Map();
  ordered.forEach((c, i) => {
    // start at the left and go clockwise so device order (left -> right) roughly matches
    const angle = Math.PI + (m > 1 ? (2 * Math.PI * i) / m : Math.PI / 2) + (m > 1 ? Math.PI / m : 0);
    customerPos.set(c.customer_id, {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    });
  });

  const maxTx = Math.max(1, ...edges.map((e) => Number(e.transaction_count) || 1));
  const edgeWidth = (tc) => {
    const t = Number(tc) || 1;
    if (maxTx <= 1) return 1.5;
    return 1.5 + (2.5 * (t - 1)) / (maxTx - 1);
  };

  return { customers: ordered, devices, edges, customerPos, devicePos, edgeWidth };
}

export default function NetworkGraph({
  cluster,
  height = 360,
  onCustomerClick,
  highlightCustomerId,
  compact = false,
}) {
  const navigate = useNavigate();
  const [hover, setHover] = useState(null); // {type: 'customer'|'device', id}

  const width = compact ? 480 : 640;
  const layout = useMemo(
    () => computeLayout(cluster, width, height, compact),
    [cluster, width, height, compact]
  );
  const { customers, devices, edges, customerPos, devicePos, edgeWidth } = layout;

  const neighbours = useMemo(() => {
    if (!hover) return null;
    const set = new Set([`${hover.type}:${hover.id}`]);
    edges.forEach((e) => {
      if (hover.type === 'customer' && e.customer_id === hover.id) set.add(`device:${e.device_id}`);
      if (hover.type === 'device' && e.device_id === hover.id) set.add(`customer:${e.customer_id}`);
    });
    return set;
  }, [hover, edges]);

  const isEdgeActive = (e) =>
    hover &&
    ((hover.type === 'customer' && e.customer_id === hover.id) ||
      (hover.type === 'device' && e.device_id === hover.id));

  const nodeState = (type, id) => {
    if (!neighbours) return '';
    return neighbours.has(`${type}:${id}`) ? ' is-active' : ' is-dimmed';
  };

  const openCustomer = (id) => {
    if (onCustomerClick) onCustomerClick(id);
    else navigate(`/customers/${encodeURIComponent(id)}`);
  };

  const showCustomerLabels = !compact || customers.length <= 16;
  const deviceCustomerCount = (d) => d.customer_count ?? edges.filter((e) => e.device_id === d.device_id).length;

  if (!cluster || (!customers.length && !devices.length)) {
    return <div className="ng-empty" style={{ height }}>No graph data</div>;
  }

  return (
    <div className={`ng${compact ? ' ng--compact' : ''}${hover ? ' ng--hovering' : ''}`}>
      <svg
        className="ng__svg"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Network of ${plural(customers.length, 'customer')} and ${plural(devices.length, 'device')}`}
      >
        <g className="ng__edges">
          {edges.map((e) => {
            const a = customerPos.get(e.customer_id);
            const b = devicePos.get(e.device_id);
            if (!a || !b) return null;
            const active = isEdgeActive(e);
            return (
              <line
                key={`${e.customer_id}-${e.device_id}`}
                className={`ng__edge${hover ? (active ? ' is-active' : ' is-dimmed') : ''}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                strokeWidth={edgeWidth(e.transaction_count)}
                strokeLinecap="round"
              >
                <title>{`${e.customer_id} → ${e.device_id}: ${plural(Number(e.transaction_count) || 0, 'transaction')}`}</title>
              </line>
            );
          })}
        </g>

        <g className="ng__devices">
          {devices.map((d) => {
            const p = devicePos.get(d.device_id);
            if (!p) return null;
            const half = DEVICE_SIZE / 2;
            return (
              <g
                key={d.device_id}
                className={`ng__device${d.is_shared ? ' is-shared' : ''}${nodeState('device', d.device_id)}`}
                transform={`translate(${p.x} ${p.y})`}
                onMouseEnter={() => setHover({ type: 'device', id: d.device_id })}
                onMouseLeave={() => setHover(null)}
              >
                <title>
                  {`Device ${d.device_id} · used by ${plural(deviceCustomerCount(d), 'customer')} · ${plural(
                    Number(d.transaction_count) || 0,
                    'transaction'
                  )}${d.is_shared ? ' · shared device' : ''}`}
                </title>
                {d.is_shared && (
                  <rect
                    className="ng__device-glow"
                    x={-half - 5}
                    y={-half - 5}
                    width={DEVICE_SIZE + 10}
                    height={DEVICE_SIZE + 10}
                    rx={10}
                  />
                )}
                <rect className="ng__device-box" x={-half} y={-half} width={DEVICE_SIZE} height={DEVICE_SIZE} rx={7} />
                <rect className="ng__device-glyph" x={-5} y={-8} width={10} height={16} rx={2} />
                <line className="ng__device-glyph" x1={-1.5} y1={5} x2={1.5} y2={5} strokeLinecap="round" />
                {!(compact && devices.length > 4) && (
                  <text className="ng__label ng__label--device" y={half + 14} textAnchor="middle">
                    {d.device_id}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        <g className="ng__customers">
          {customers.map((c) => {
            const p = customerPos.get(c.customer_id);
            if (!p) return null;
            const meta = getLevelMeta(c.max_level);
            const highlighted = highlightCustomerId && highlightCustomerId === c.customer_id;
            const tip = `${c.customer_id} · ${plural(Number(c.transaction_count) || 0, 'transaction')} · ${plural(
              Number(c.flag_count) || 0,
              'flag'
            )} · ${levelLabel(c.max_level)} risk`;
            return (
              <g
                key={c.customer_id}
                className={`ng__customer${highlighted ? ' is-highlighted' : ''}${nodeState('customer', c.customer_id)}`}
                transform={`translate(${p.x} ${p.y})`}
                tabIndex={0}
                role="link"
                aria-label={`Open customer ${tip}`}
                onMouseEnter={() => setHover({ type: 'customer', id: c.customer_id })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ type: 'customer', id: c.customer_id })}
                onBlur={() => setHover(null)}
                onClick={() => openCustomer(c.customer_id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    openCustomer(c.customer_id);
                  }
                }}
              >
                <title>{tip}</title>
                <circle className="ng__focus" r={CUSTOMER_R + 5} />
                {highlighted && <circle className="ng__ring" r={CUSTOMER_R + 5} />}
                <circle
                  className="ng__customer-dot"
                  r={CUSTOMER_R}
                  style={{ fill: meta.soft, stroke: meta.color }}
                />
                {showCustomerLabels && (
                  <text className="ng__label" y={CUSTOMER_R + 14} textAnchor="middle">
                    {c.customer_id}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
