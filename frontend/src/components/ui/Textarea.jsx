import { forwardRef, useId } from 'react';
import '../../styles/ui-interactive.css';

/**
 * Textarea({ label, hint, error, mono, rows = 4, className, textareaClassName, id, required, ...native textarea props })
 */
export const Textarea = forwardRef(function Textarea(
  { label, hint, error, mono = false, rows = 4, className = '', textareaClassName = '', id, required, ...rest },
  ref
) {
  const autoId = useId();
  const taId = id || `ta-${autoId}`;
  const hintId = `${taId}-hint`;
  const errId = `${taId}-err`;
  const describedBy = [error ? errId : null, hint && !error ? hintId : null, rest['aria-describedby']]
    .filter(Boolean)
    .join(' ');
  const controlClass = [
    'ui-control',
    mono ? 'ui-control--mono' : '',
    error ? 'ui-control--invalid' : '',
    textareaClassName,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={`ui-field ${className}`.trim()}>
      {label && (
        <label htmlFor={taId} className="ui-field__label">
          {label}
          {required && (
            <span className="ui-field__req" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <textarea
        ref={ref}
        id={taId}
        rows={rows}
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

export default Textarea;
