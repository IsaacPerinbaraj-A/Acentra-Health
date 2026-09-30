import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import '../../styles/ui-interactive.css';

const MAX_CHIPS = 2;

/**
 * MultiSelect({ label, options = [{value, label}], value = [], onChange(string[]), disabled, className })
 * Dropdown of checkboxes; selected values are shown as chips in the trigger.
 * Keyboard: Enter/Space/ArrowDown opens, arrows move between options, Space/Enter toggles, Esc closes.
 */
export function MultiSelect({ label, options = [], value = [], onChange, disabled = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();
  const selected = Array.isArray(value) ? value.map(String) : [];

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const first = panelRef.current?.querySelector('input[type="checkbox"]');
      first?.focus();
    }
  }, [open]);

  const toggle = (val) => {
    const v = String(val);
    const next = selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v];
    const order = options.map((o) => String(o.value));
    next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    onChange?.(next);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onPanelKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      const boxes = Array.from(panelRef.current?.querySelectorAll('input[type="checkbox"]') || []);
      if (!boxes.length) return;
      e.preventDefault();
      const idx = boxes.indexOf(document.activeElement);
      let next = idx;
      if (e.key === 'ArrowDown') next = idx < boxes.length - 1 ? idx + 1 : 0;
      if (e.key === 'ArrowUp') next = idx > 0 ? idx - 1 : boxes.length - 1;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = boxes.length - 1;
      boxes[next]?.focus();
      return;
    }
    if (e.key === 'Enter' && e.target.type === 'checkbox') {
      e.preventDefault();
      e.target.click();
    }
  };

  const labelFor = (v) => options.find((o) => String(o.value) === v)?.label ?? v;
  const chips = selected.slice(0, MAX_CHIPS);
  const overflow = selected.length - chips.length;
  const summary = selected.length ? selected.map(labelFor).join(', ') : 'any';

  return (
    <div className={`ui-ms ${className}`.trim()} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`ui-ms__trigger${selected.length ? ' ui-ms__trigger--active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${label || 'Filter'}: ${summary}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        {label && <span className="ui-ms__label">{label}</span>}
        {chips.length > 0 && (
          <span className="ui-ms__chips" aria-hidden="true">
            {chips.map((v) => (
              <span key={v} className="ui-ms__chip">
                {labelFor(v)}
              </span>
            ))}
            {overflow > 0 && <span className="ui-ms__chip">+{overflow}</span>}
          </span>
        )}
        <ChevronDown size={16} strokeWidth={1.75} className="ui-ms__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={panelId}
          ref={panelRef}
          className="ui-ms__panel"
          role="group"
          aria-label={label || 'Options'}
          onKeyDown={onPanelKey}
        >
          {options.length === 0 && <div className="ui-ms__empty">No options</div>}
          {options.map((o) => {
            const v = String(o.value);
            return (
              <label key={v} className="ui-ms__option">
                <input
                  type="checkbox"
                  className="ui-ms__check"
                  checked={selected.includes(v)}
                  onChange={() => toggle(o.value)}
                />
                <span>{o.label}</span>
              </label>
            );
          })}
          {options.length > 0 && (
            <div className="ui-ms__footer">
              <span>{selected.length ? `${selected.length} selected` : 'None selected'}</span>
              <button
                type="button"
                className="ui-ms__clear"
                disabled={!selected.length}
                onClick={() => onChange?.([])}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MultiSelect;
