import { AlertCircle, AlertTriangle, CheckCircle2, Info, Sparkles, X } from 'lucide-react';
import '../../styles/ui-display.css';

const DEFAULT_ICONS = {
  brand: Sparkles,
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
  success: CheckCircle2,
};

/** Banner({ tone = 'brand' (brand | info | warning | error | success), icon, title, children, action, onDismiss }) */
export function Banner({ tone = 'brand', icon, title, children, action, onDismiss, className = '' }) {
  const Icon = icon === null ? null : icon || DEFAULT_ICONS[tone] || Info;
  return (
    <div
      className={`banner banner--${tone}${className ? ` ${className}` : ''}`}
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
    >
      {Icon && (
        <span className="banner__icon" aria-hidden="true">
          <Icon size={16} strokeWidth={1.75} />
        </span>
      )}
      <div className="banner__body">
        {title && <div className="banner__title">{title}</div>}
        {children && <div className="banner__text">{children}</div>}
      </div>
      {action && <div className="banner__action">{action}</div>}
      {onDismiss && (
        <button type="button" className="banner__close" onClick={onDismiss} aria-label="Dismiss">
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default Banner;
