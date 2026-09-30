import { getRuleMeta } from '../../constants/ruleMeta.js';
import '../../styles/ui-display.css';

/**
 * RuleChip({ name, label, points, size = 'sm', className })
 * Rule color at 12% alpha background, rule icon + label in the rule color (mixed toward --text for contrast).
 */
export function RuleChip({ name, label, points, size = 'sm', className = '', title }) {
  const m = getRuleMeta(name, label);
  const Icon = m.icon;
  const text = label || m.shortName || m.displayName;
  const hasPoints = points != null && points !== '' && !Number.isNaN(Number(points));
  return (
    <span
      className={`rule-chip rule-chip--${size}${className ? ` ${className}` : ''}`}
      style={{ '--rule-color': `var(${m.cssVar})` }}
      title={title || m.displayName}
    >
      {Icon && <Icon size={12} strokeWidth={2} aria-hidden="true" className="rule-chip__icon" />}
      <span className="rule-chip__label">{text}</span>
      {hasPoints && (
        <span className="rule-chip__points">
          {Number(points) > 0 ? '+' : ''}
          {Number(points)}
        </span>
      )}
    </span>
  );
}

export default RuleChip;
