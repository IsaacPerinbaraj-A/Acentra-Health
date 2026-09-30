import { Inbox } from 'lucide-react';
import '../../styles/ui-display.css';

/** EmptyState({ icon, title, description, action, tone = 'neutral' (neutral | success | brand), compact }) */
export function EmptyState({ icon: Icon = Inbox, title, description, action, tone = 'neutral', compact = false, className = '' }) {
  return (
    <div className={`empty-state empty-state--${tone}${compact ? ' empty-state--compact' : ''}${className ? ` ${className}` : ''}`}>
      <span className="empty-state__icon" aria-hidden="true">
        <Icon size={24} strokeWidth={1.75} />
      </span>
      {title && <h3 className="empty-state__title">{title}</h3>}
      {description && <p className="empty-state__desc">{description}</p>}
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

export default EmptyState;
