import { Plane } from 'lucide-react';
import { Card } from '../ui';
import TravelMap from '../TravelMap';
import { getLevelMeta, normalizeLevel } from '../../constants/levels';
import { formatDistanceKm, formatDuration, formatSpeed, formatNumber } from '../../utils/format';
import '../../styles/pages/evidence.css';

/**
 * Impossible-travel evidence card.
 * Props: details (impossible_travel details) or result ({details}), level, mapHeight=280.
 */
export default function TravelEvidence({ details, result, level, mapHeight = 280, className = '' }) {
  const d = details || result?.details || {};
  const lvl = normalizeLevel(level) || 'HIGH';
  const meta = getLevelMeta(lvl);
  const speed = Number(d.speed_kmh);
  const max = Number(d.max_speed_kmh) || 900;
  const factor = Number.isFinite(speed) && max > 0 ? speed / max : null;
  const route = `${d.previous_city || 'Previous location'} → ${d.current_city || 'This location'}`;

  return (
    <Card
      title="Impossible travel"
      subtitle={route}
      icon={Plane}
      className={`ev-card ${className}`.trim()}
      style={{ '--ev-level': meta.color, '--ev-level-soft': meta.soft, '--ev-level-on-soft': meta.onSoft }}
    >
      <TravelMap details={d} level={lvl} height={mapHeight} />
      <dl className="ev-stats ev-stats--3">
        <div className="ev-stat">
          <dt className="ev-stat__label">Distance</dt>
          <dd className="ev-stat__value">{formatDistanceKm(d.distance_km)}</dd>
          <dd className="ev-stat__sub">great-circle</dd>
        </div>
        <div className="ev-stat">
          <dt className="ev-stat__label">Time between</dt>
          <dd className="ev-stat__value">{formatDuration(d.elapsed_minutes)}</dd>
          <dd className="ev-stat__sub">since previous transaction</dd>
        </div>
        <div className="ev-stat">
          <dt className="ev-stat__label">Implied speed</dt>
          <dd className="ev-stat__value ev-stat__value--level">{formatSpeed(d.speed_kmh)}</dd>
          <dd className="ev-stat__sub">
            vs max {formatSpeed(max)}
            {factor !== null && factor > 1 && (
              <span className="ev-ratio">{formatNumber(factor, 1)}× max</span>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
