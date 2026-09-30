import '../../styles/ui-display.css';

/** Kbd({ children }) — keyboard key hint. */
export function Kbd({ children, className = '' }) {
  return <kbd className={`kbd${className ? ` ${className}` : ''}`}>{children}</kbd>;
}

export default Kbd;
