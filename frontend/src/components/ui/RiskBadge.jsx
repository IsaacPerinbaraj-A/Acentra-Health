import { LEVEL_META, normalizeLevel } from '../../constants/levels.js';
import '../../styles/ui-display.css';

/** RiskBadge({ level, size = 'md' }) — soft pill, 6 px solid dot, uppercase label. CRITICAL dot pulses. */
export function RiskBadge({ level, size = 'md', className = '' }) {
  const key = normalizeLevel(level);
  if (!key) {
    return <span className="risk-badge risk-badge--none">—</span>;
  }
  const m = LEVEL_META[key];
  return (
    <span
      className={`risk-badge risk-badge--${size} risk-badge--${key.toLowerCase()}${className ? ` ${className}` : ''}`}
      style={{ '--badge-bg': m.soft, '--badge-fg': m.onSoft, '--badge-dot': m.color }}
      title={`${m.label} risk`}
    >
      <span className="risk-badge__dot" aria-hidden="true" />
      {m.label}
    </span>
  );
}

export default RiskBadge;
