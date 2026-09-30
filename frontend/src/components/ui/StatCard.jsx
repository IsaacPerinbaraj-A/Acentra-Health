import { Link } from 'react-router-dom';
import { Skeleton } from './Skeleton.jsx';
import '../../styles/ui-display.css';

/**
 * StatCard({ label, value, sub, icon, color, to, onClick, loading, className })
 * color: any CSS color (e.g. var(--level-critical)); tints the 36 px icon square.
 * to -> react-router Link; onClick -> button; otherwise a static div.
 */
export function StatCard({ label, value, sub, icon: Icon, color, to, onClick, loading = false, className = '', ...rest }) {
  const clickable = Boolean(to || onClick);
  const Comp = to ? Link : onClick ? 'button' : 'div';
  const extra = to ? { to } : onClick ? { type: 'button', onClick } : {};
  return (
    <Comp
      className={`stat-card${clickable ? ' stat-card--clickable' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--stat-color': color || 'var(--brand)' }}
      aria-busy={loading || undefined}
      {...extra}
      {...rest}
    >
      <span className="stat-card__top">
        <span className="stat-card__label">{label}</span>
        {Icon && (
          <span className="stat-card__icon" aria-hidden="true">
            <Icon size={18} strokeWidth={1.75} />
          </span>
        )}
      </span>
      <span className="stat-card__value">{loading ? <Skeleton width={96} height={32} /> : value ?? '—'}</span>
      {(sub != null || loading) && (
        <span className="stat-card__sub">{loading ? <Skeleton width="70%" height={12} /> : sub}</span>
      )}
    </Comp>
  );
}

export default StatCard;
