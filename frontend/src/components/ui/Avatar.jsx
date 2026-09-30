import { initials } from '../../utils/format.js';
import '../../styles/ui-display.css';

const HUES = ['--brand', '--rule-velocity', '--rule-unusual-amount', '--rule-balance-drain', '--rule-impossible-travel', '--status-cleared'];

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Avatar({ name, size = 32 }) — initials on a tinted circle; hue is stable per name. */
export function Avatar({ name, size = 32, className = '' }) {
  const n = String(name || '');
  const hue = HUES[hash(n) % HUES.length];
  return (
    <span
      className={`avatar${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)), '--avatar-color': `var(${hue})` }}
      title={n || undefined}
      role="img"
      aria-label={n || 'User'}
    >
      {initials(n)}
    </span>
  );
}

export default Avatar;
