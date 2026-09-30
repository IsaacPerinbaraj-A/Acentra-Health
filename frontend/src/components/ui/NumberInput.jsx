import { useEffect, useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import '../../styles/ui-interactive.css';

function clamp(n, min, max) {
  let v = n;
  if (typeof min === 'number' && v < min) v = min;
  if (typeof max === 'number' && v > max) v = max;
  return v;
}

function roundToStep(n, step) {
  const decimals = (String(step).split('.')[1] || '').length;
  return decimals ? Number(n.toFixed(decimals)) : Math.round(n);
}

/**
 * NumberInput({ value, onChange(number), min, max, step = 1, disabled, label, hint, error, width, 'aria-label', className })
 * Stepper with −/+ buttons; typing is free-form and clamped on blur.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
  label,
  hint,
  error,
  width,
  className = '',
  id,
  'aria-label': ariaLabel,
}) {
  const autoId = useId();
  const inputId = id || `num-${autoId}`;
  const [draft, setDraft] = useState(value === null || value === undefined ? '' : String(value));

  useEffect(() => {
    setDraft(value === null || value === undefined ? '' : String(value));
  }, [value]);

  const numeric = Number(value);
  const hasValue = value !== null && value !== undefined && value !== '' && !Number.isNaN(numeric);

  const emit = (n) => {
    const next = roundToStep(clamp(n, min, max), step);
    setDraft(String(next));
    if (next !== value) onChange?.(next);
  };

  const bump = (dir) => emit((hasValue ? numeric : typeof min === 'number' ? min : 0) + dir * step);

  const onInput = (e) => {
    const raw = e.target.value;
    setDraft(raw);
    if (raw === '' || raw === '-') return;
    const n = Number(raw);
    if (!Number.isNaN(n) && (typeof min !== 'number' || n >= min) && (typeof max !== 'number' || n <= max)) {
      onChange?.(n);
    }
  };

  const onBlur = () => {
    const n = Number(draft);
    if (draft === '' || Number.isNaN(n)) {
      setDraft(hasValue ? String(value) : '');
      return;
    }
    emit(n);
  };

  const control = (
    <div
      className={`ui-num${disabled ? ' ui-num--disabled' : ''}${error ? ' ui-num--invalid' : ''}`}
      style={width ? { width } : undefined}
    >
      <button
        type="button"
        className="ui-num__btn"
        aria-label="Decrease"
        tabIndex={-1}
        disabled={disabled || (hasValue && typeof min === 'number' && numeric <= min)}
        onClick={() => bump(-1)}
      >
        <Minus size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        className="ui-num__input"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel || 'Value'}
        aria-invalid={error ? true : undefined}
        onChange={onInput}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onBlur();
        }}
        onWheel={(e) => e.currentTarget.blur()}
      />
      <button
        type="button"
        className="ui-num__btn"
        aria-label="Increase"
        tabIndex={-1}
        disabled={disabled || (hasValue && typeof max === 'number' && numeric >= max)}
        onClick={() => bump(1)}
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );

  if (!label && !hint && !error) {
    return className ? <div className={className}>{control}</div> : control;
  }
  return (
    <div className={`ui-field ${className}`.trim()}>
      {label && (
        <label htmlFor={inputId} className="ui-field__label">
          {label}
        </label>
      )}
      {control}
      {error ? (
        <div className="ui-field__error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="ui-field__hint">{hint}</div>
      ) : null}
    </div>
  );
}

export default NumberInput;
