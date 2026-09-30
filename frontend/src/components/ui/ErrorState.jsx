import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from './Button.jsx';
import '../../styles/ui-display.css';

function messageOf(error) {
  if (!error) return 'An unexpected error occurred.';
  if (typeof error === 'string') return error;
  if (typeof error.detail === 'string') return error.detail;
  return error.message || 'An unexpected error occurred.';
}

/** ErrorState({ error, onRetry, title = 'Something went wrong', compact }) — AlertTriangle + message + Retry. */
export function ErrorState({ error, onRetry, title = 'Something went wrong', compact = false, retrying = false, className = '' }) {
  return (
    <div className={`error-state${compact ? ' error-state--compact' : ''}${className ? ` ${className}` : ''}`} role="alert">
      <span className="error-state__icon" aria-hidden="true">
        <AlertTriangle size={24} strokeWidth={1.75} />
      </span>
      <h3 className="error-state__title">{title}</h3>
      <p className="error-state__msg">{messageOf(error)}</p>
      {onRetry && (
        <Button size="sm" icon={RotateCw} onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      )}
    </div>
  );
}

export default ErrorState;
