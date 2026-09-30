import { Calendar, X } from 'lucide-react';
import '../../styles/ui-interactive.css';

/**
 * DateRange({ from, to, onChange({from, to}), label, disabled, className })
 * Two native date inputs (YYYY-MM-DD strings; '' when empty).
 */
export function DateRange({ from = '', to = '', onChange, label, disabled = false, className = '' }) {
  const f = from || '';
  const t = to || '';
  return (
    <div className={`ui-daterange ${className}`.trim()} role="group" aria-label={label || 'Date range'}>
      <Calendar size={16} strokeWidth={1.75} className="ui-daterange__icon" aria-hidden="true" />
      {label && <span className="ui-daterange__label">{label}</span>}
      <input
        type="date"
        className="ui-daterange__input"
        value={f}
        max={t || undefined}
        disabled={disabled}
        aria-label="From date"
        onChange={(e) => onChange?.({ from: e.target.value, to: t })}
      />
      <span className="ui-daterange__sep" aria-hidden="true">
        –
      </span>
      <input
        type="date"
        className="ui-daterange__input"
        value={t}
        min={f || undefined}
        disabled={disabled}
        aria-label="To date"
        onChange={(e) => onChange?.({ from: f, to: e.target.value })}
      />
      {(f || t) && !disabled && (
        <button
          type="button"
          className="ui-daterange__clear"
          aria-label="Clear dates"
          onClick={() => onChange?.({ from: '', to: '' })}
        >
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default DateRange;
