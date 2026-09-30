import { Loader2 } from 'lucide-react';
import '../../styles/ui-display.css';

/** Spinner({ size = 16, label = 'Loading', className }) — only inside buttons/inline; pages use skeletons. */
export function Spinner({ size = 16, label = 'Loading', className = '' }) {
  return (
    <Loader2
      size={size}
      strokeWidth={2}
      className={`spinner ${className}`.trim()}
      role="status"
      aria-label={label}
    />
  );
}

export default Spinner;
