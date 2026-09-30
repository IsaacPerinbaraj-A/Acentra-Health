import { useId } from 'react';
import '../../styles/ui-interactive.css';

/**
 * Switch({ checked, onChange(bool), label, disabled, size = 'md' | 'sm', 'aria-label', className })
 * role="switch" button; clicking the label toggles too.
 */
export function Switch({
  checked = false,
  onChange,
  label,
  disabled = false,
  size = 'md',
  className = '',
  'aria-label': ariaLabel,
  ...rest
}) {
  const labelId = useId();
  const toggle = () => {
    if (!disabled) onChange?.(!checked);
  };
  return (
    <span
      className={`ui-switch ui-switch--${size}${disabled ? ' ui-switch--disabled' : ''} ${className}`.trim()}
    >
      <button
        type="button"
        role="switch"
        className="ui-switch__track"
        aria-checked={!!checked}
        aria-labelledby={label && !ariaLabel ? labelId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={toggle}
        {...rest}
      >
        <span className="ui-switch__thumb" aria-hidden="true" />
      </button>
      {label && (
        <span id={labelId} className="ui-switch__label" onClick={toggle}>
          {label}
        </span>
      )}
    </span>
  );
}

export default Switch;
