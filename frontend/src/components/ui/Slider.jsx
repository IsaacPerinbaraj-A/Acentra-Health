import '../../styles/ui-interactive.css';

/**
 * Slider({ value, onChange(number), min = 0, max = 100, step = 1, disabled, 'aria-label', className, ...rest })
 * Native range input with a brand-colored fill.
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  className = '',
  'aria-label': ariaLabel = 'Value',
  ...rest
}) {
  const n = Number(value);
  const v = Number.isNaN(n) ? min : Math.min(max, Math.max(min, n));
  const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className={`ui-slider ${className}`.trim()}
      min={min}
      max={max}
      step={step}
      value={v}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-valuetext={String(v)}
      style={{ '--slider-pct': `${pct}%` }}
      onChange={(e) => onChange?.(Number(e.target.value))}
      {...rest}
    />
  );
}

export default Slider;
