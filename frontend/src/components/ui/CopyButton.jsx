import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Tooltip } from './Tooltip.jsx';
import '../../styles/ui-display.css';

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** CopyButton({ value, label = 'Copy', size = 'sm' }) — copies value; icon swaps to a check for 1.5 s ("Copied"). */
export function CopyButton({ value, label = 'Copy', size = 'sm', className = '' }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = await copyText(String(value ?? ''));
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  const Icon = copied ? Check : Copy;
  return (
    <Tooltip content={copied ? 'Copied' : label}>
      <button
        type="button"
        className={`copy-btn copy-btn--${size}${copied ? ' is-copied' : ''}${className ? ` ${className}` : ''}`}
        onClick={onClick}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={copied ? 'Copied' : `${label}${value != null ? ` ${value}` : ''}`}
      >
        <Icon size={size === 'xs' ? 12 : 14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

export default CopyButton;
