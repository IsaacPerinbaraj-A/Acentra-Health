import { forwardRef, useId } from 'react';
import '../../styles/ui-interactive.css';

/**
 * Input({ label, hint, error, mono, className, inputClassName, id, required, ...native input props })
 * error (string) turns the border red, sets aria-invalid and replaces the hint.
 */
export const Input = forwardRef(function Input(
  { label, hint, error, mono = false, className = '', inputClassName = '', id, required, type = 'text', ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id || `in-${autoId}`;
  const hintId = `${inputId}-hint`;
  const errId = `${inputId}-err`;
  const describedBy = [error ? errId : null, hint && !error ? hintId : null, rest['aria-describedby']]
    .filter(Boolean)
    .join(' ');
  const controlClass = [
    'ui-control',
    mono ? 'ui-control--mono' : '',
    error ? 'ui-control--invalid' : '',
    inputClassName,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={`ui-field ${className}`.trim()}>
      {label && (
        <label htmlFor={inputId} className="ui-field__label">
          {label}
          {required && (
            <span className="ui-field__req" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        type={type}
        required={required}
        {...rest}
        className={controlClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {error ? (
        <div id={errId} className="ui-field__error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div id={hintId} className="ui-field__hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
});

export default Input;
