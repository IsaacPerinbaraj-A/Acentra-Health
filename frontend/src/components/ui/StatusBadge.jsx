import { getStatusMeta } from '../../constants/statuses.js';
import '../../styles/ui-display.css';

/** StatusBadge({ status, size = 'md' }) — icon + label pill; CONFIRMED_FRAUD is solid-filled. */
export function StatusBadge({ status, size = 'md', className = '' }) {
  if (!status) return <span className="status-badge status-badge--none">—</span>;
  const m = getStatusMeta(status);
  const Icon = m.icon;
  return (
    <span
      className={`status-badge status-badge--${size}${m.solid ? ' status-badge--solid' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--badge-bg': m.soft, '--badge-fg': m.onSoft, '--badge-icon': m.solid ? m.onSoft : m.color }}
    >
      {Icon && <Icon size={size === 'sm' ? 12 : 14} strokeWidth={2} aria-hidden="true" className="status-badge__icon" />}
      {m.label}
    </span>
  );
}

export default StatusBadge;
