import { useRef } from 'react';
import '../../styles/ui-interactive.css';

function formatCount(n) {
  if (n === null || n === undefined || n === '') return null;
  return typeof n === 'number' ? n.toLocaleString('en-IN') : n;
}

/**
 * Tabs({ tabs = [{key, label, count?, icon?}], value, onChange(key), className, 'aria-label' })
 * Underline tabs with count pills; arrow keys / Home / End move between tabs.
 */
export function Tabs({ tabs = [], value, onChange, className = '', 'aria-label': ariaLabel = 'Tabs' }) {
  const listRef = useRef(null);
  const onKeyDown = (e) => {
    if (!tabs.length) return;
    const idx = Math.max(0, tabs.findIndex((t) => t.key === value));
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange?.(tabs[next].key);
    const btn = listRef.current?.querySelectorAll('[role="tab"]')[next];
    btn?.focus();
  };
  return (
    <div
      className={`ui-tabs ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
      ref={listRef}
      onKeyDown={onKeyDown}
    >
      {tabs.map((t) => {
        const selected = t.key === value;
        const count = formatCount(t.count);
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            className="ui-tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange?.(t.key)}
          >
            {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
            <span>{t.label}</span>
            {count !== null && <span className="ui-tab__count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
