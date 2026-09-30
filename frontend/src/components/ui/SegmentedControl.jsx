import { useRef } from 'react';
import '../../styles/ui-interactive.css';

/**
 * SegmentedControl({ options = [{value, label, icon?, disabled?, ariaLabel?}], value, onChange(value),
 *                    size = 'md' | 'sm', className, 'aria-label' })
 * Radio-group semantics; arrow keys move the selection.
 */
export function SegmentedControl({
  options = [],
  value,
  onChange,
  size = 'md',
  className = '',
  'aria-label': ariaLabel = 'Options',
}) {
  const ref = useRef(null);
  const onKeyDown = (e) => {
    const enabled = options.filter((o) => !o.disabled);
    if (!enabled.length) return;
    const idx = Math.max(0, enabled.findIndex((o) => o.value === value));
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + enabled.length) % enabled.length;
    if (next < 0) return;
    e.preventDefault();
    onChange?.(enabled[next].value);
    const btns = Array.from(ref.current?.querySelectorAll('[role="radio"]') || []);
    const target = btns.find((b) => b.dataset.segValue === String(enabled[next].value));
    target?.focus();
  };
  return (
    <div
      ref={ref}
      className={`ui-seg ui-seg--${size} ${className}`.trim()}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const checked = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="ui-seg__btn"
            disabled={o.disabled}
            data-seg-value={String(o.value)}
            onClick={() => onChange?.(o.value)}
            aria-label={o.ariaLabel}
          >
            {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
