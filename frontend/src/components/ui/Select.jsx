import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import '../../styles/ui-interactive.css';

/**
 * Select({ label, options = [{value, label}], value, onChange(value), placeholder, disabled, width, className, ...rest })
 * Native <select> styled as a control; `label` is shown as a muted prefix inside the control.
 * onChange receives the option's original value (numbers stay numbers); '' for the placeholder.
 */
export function Select({
  label,
  options = [],
  value,
  onChange,
  placeholder,
  disabled = false,
  className = '',
  width,
  id,
  'aria-label': ariaLabel,
  ...rest
}) {
  const autoId = useId();
  const selectId = id || `sel-${autoId}`;
  const current = value === null || value === undefined ? '' : String(value);
  const handle = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange?.('');
      return;
    }
    const opt = options.find((o) => String(o.value) === raw);
    onChange?.(opt ? opt.value : raw);
  };
  return (
    <div
      className={`ui-select${disabled ? ' ui-select--disabled' : ''} ${className}`.trim()}
      style={width ? { width } : undefined}
    >
      {label && (
        <label htmlFor={selectId} className="ui-select__label">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className="ui-select__native"
        value={current}
        onChange={handle}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel || placeholder}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={16} strokeWidth={1.75} className="ui-select__chevron" aria-hidden="true" />
    </div>
  );
}

export default Select;
