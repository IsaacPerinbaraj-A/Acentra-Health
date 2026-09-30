import '../../styles/ui-display.css';

/** Pill({ tone = 'neutral' (neutral | brand | success | warning | error | info), icon, children, size = 'sm' }) */
export function Pill({ tone = 'neutral', icon: Icon, children, size = 'sm', className = '', title }) {
  return (
    <span className={`pill pill--${tone} pill--${size}${className ? ` ${className}` : ''}`} title={title}>
      {Icon && <Icon size={size === 'md' ? 14 : 12} strokeWidth={2} aria-hidden="true" />}
      {children}
    </span>
  );
}

export default Pill;
