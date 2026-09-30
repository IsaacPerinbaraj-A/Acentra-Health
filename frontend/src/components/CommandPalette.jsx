import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  ArrowRight,
  CornerDownLeft,
  Database,
  Hash,
  LayoutDashboard,
  Moon,
  Network,
  Search,
  ShieldAlert,
  Sun,
  User,
} from 'lucide-react';
import { RiskBadge, Spinner, useToast } from './ui';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { trackActivity } from '../hooks/useApi.js';
import { apiFetch } from '../api/client.js';
import { formatINR } from '../utils/format.js';
import '../styles/pages/layout.css';

const SM = { size: 16, strokeWidth: 1.75 };

/**
 * CommandPalette ({ open, onClose })
 * Search transactions/customers/flags (GET /api/transactions?q=) + quick actions.
 * Arrow keys + Enter; Esc closes; Tab stays inside.
 */
export default function CommandPalette({ open, onClose }) {
  if (!open) return null;
  return <PaletteDialog onClose={onClose} />;
}

function PaletteDialog({ onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { hasRole, user } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const isAdmin = hasRole ? hasRole('ADMIN') : user?.role === 'ADMIN';

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState({ loading: false, items: [], q: '' });
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const restoreRef = useRef(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const trimmed = query.trim();
  const debounced = useDebounce(trimmed, 300);

  // focus management: remember the trigger, focus input, restore on close
  useEffect(() => {
    restoreRef.current = document.activeElement;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      const el = restoreRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) {
        try {
          el.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  // debounced transaction search (errors fail silently)
  useEffect(() => {
    if (debounced.length < 2) {
      setSearch({ loading: false, items: [], q: debounced });
      return undefined;
    }
    const controller = new AbortController();
    setSearch((s) => ({ ...s, loading: true }));
    apiFetch('/api/transactions', { query: { q: debounced, page_size: 8 }, signal: controller.signal })
      .then((data) => setSearch({ loading: false, items: data?.items || [], q: debounced }))
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setSearch({ loading: false, items: [], q: debounced });
      });
    return () => controller.abort();
  }, [debounced]);

  const go = useCallback(
    (to) => {
      onClose();
      navigate(to);
    },
    [navigate, onClose]
  );

  const loadDemo = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await trackActivity(apiFetch('/api/admin/demo/load', { method: 'POST' }));
      toast({
        variant: 'success',
        title: 'Demo data loaded',
        message: res
          ? `${res.processed ?? 0} processed · ${res.flagged ?? 0} flagged · ${res.alerts ?? 0} alerts`
          : undefined,
        action: { label: 'Open queue', onClick: () => navigate('/flags') },
      });
      onClose();
    } catch (err) {
      toast({ variant: 'error', title: "Couldn't load demo data", message: err?.message || String(err) });
      setBusy(false);
    }
  }, [busy, toast, navigate, onClose]);

  const sections = useMemo(() => {
    const out = [];
    const q = trimmed.toLowerCase();

    const flagMatch = /^#?(\d{1,9})$/.exec(trimmed);
    if (flagMatch) {
      const n = Number(flagMatch[1]);
      out.push({
        key: 'flag',
        label: 'Flags',
        items: [
          {
            id: `flag-${n}`,
            icon: Hash,
            label: `Open flag #${n}`,
            hint: 'Flag detail',
            run: () => go(`/flags/${n}`),
          },
        ],
      });
    }

    const txItems = trimmed.length >= 2 && search.q === debounced ? search.items : [];
    if (txItems.length) {
      out.push({
        key: 'tx',
        label: 'Transactions',
        items: txItems.map((t) => ({
          id: `tx-${t.transaction_id}`,
          icon: ArrowLeftRight,
          label: t.transaction_id,
          mono: true,
          meta: [t.customer_id, t.merchant, t.city].filter(Boolean).join(' · '),
          amount: formatINR(t.amount, t.currency || 'INR'),
          level: t.flag_id ? t.risk_level : null,
          hint: t.flag_id ? `Flag #${t.flag_id}` : 'Transaction',
          run: () =>
            go(t.flag_id ? `/flags/${t.flag_id}` : `/transactions?q=${encodeURIComponent(t.transaction_id)}`),
        })),
      });
      const seen = new Set();
      const customers = [];
      txItems.forEach((t) => {
        if (t.customer_id && !seen.has(t.customer_id)) {
          seen.add(t.customer_id);
          customers.push(t.customer_id);
        }
      });
      if (customers.length) {
        out.push({
          key: 'cust',
          label: 'Customers',
          items: customers.map((c) => ({
            id: `cust-${c}`,
            icon: User,
            label: c,
            mono: true,
            hint: 'Customer profile',
            run: () => go(`/customers/${encodeURIComponent(c)}`),
          })),
        });
      }
    }

    const actions = [
      { id: 'a-flags', icon: ShieldAlert, label: 'Go to Flag queue', keys: 'G F', run: () => go('/flags') },
      { id: 'a-dash', icon: LayoutDashboard, label: 'Go to Dashboard', keys: 'G D', run: () => go('/') },
      { id: 'a-tx', icon: ArrowLeftRight, label: 'Go to Transactions', keys: 'G T', run: () => go('/transactions') },
      { id: 'a-net', icon: Network, label: 'Go to Network', keys: 'G N', run: () => go('/network') },
      {
        id: 'a-theme',
        icon: isDark ? Sun : Moon,
        label: 'Toggle theme',
        hint: isDark ? 'Switch to light' : 'Switch to dark',
        run: () => {
          toggleTheme();
          onClose();
        },
      },
    ];
    if (isAdmin) {
      actions.push({
        id: 'a-demo',
        icon: Database,
        label: 'Load demo data',
        hint: 'Admin',
        loading: busy,
        run: loadDemo,
      });
    }
    const filtered = q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions;
    if (filtered.length) out.push({ key: 'actions', label: 'Quick actions', items: filtered });
    return out;
  }, [trimmed, debounced, search, go, isDark, toggleTheme, onClose, isAdmin, busy, loadDemo]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  useEffect(() => {
    setActive(0);
  }, [trimmed, search.items]);

  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : -1;
  const activeItem = activeIndex >= 0 ? flat[activeIndex] : null;
  const optionId = (item) => `${baseId}-opt-${item.id}`.replace(/[^A-Za-z0-9_:-]/g, '_');

  useEffect(() => {
    if (!activeItem || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${activeIndex}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, activeItem]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flat.length) setActive((i) => (Math.min(i, flat.length - 1) + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length) setActive((i) => (Math.min(i, flat.length - 1) - 1 + flat.length) % flat.length);
    } else if (e.key === 'Home' && flat.length && !trimmed) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && flat.length && !trimmed) {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeItem && !activeItem.loading) activeItem.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      // focus trap: the input is the only tabbable element
      e.preventDefault();
      inputRef.current?.focus();
    }
  };

  const searching = trimmed.length >= 2 && (search.loading || debounced !== trimmed);
  const noResults =
    trimmed.length >= 2 && !searching && search.q === debounced && search.items.length === 0 && flat.length === 0;

  let idx = -1;
  const node = (
    <div
      className="cmdk-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="cmdk-input-row">
          <Search {...SM} aria-hidden="true" className="cmdk-input-icon" />
          <input
            ref={inputRef}
            className="cmdk-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transaction, customer or flag id, or type a command…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeItem ? optionId(activeItem) : undefined}
            aria-label="Search or run a command"
            autoComplete="off"
            spellCheck={false}
          />
          {searching && <Spinner size={16} />}
          <kbd className="cmdk-esc">Esc</kbd>
        </div>
        <div className="cmdk-list" id={listId} role="listbox" ref={listRef} aria-label="Results">
          {sections.map((section) => (
            <div className="cmdk-group" role="group" aria-label={section.label} key={section.key}>
              <div className="cmdk-group-label" aria-hidden="true">
                {section.label}
              </div>
              {section.items.map((item) => {
                idx += 1;
                const i = idx;
                const Icon = item.icon;
                const isActive = i === activeIndex;
                return (
                  <div
                    key={item.id}
                    id={optionId(item)}
                    role="option"
                    aria-selected={isActive}
                    aria-disabled={item.loading || undefined}
                    data-index={i}
                    className={`cmdk-item${isActive ? ' is-active' : ''}`}
                    onMouseMove={() => {
                      if (active !== i) setActive(i);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (!item.loading) item.run();
                    }}
                  >
                    <span className="cmdk-item-icon" aria-hidden="true">
                      {item.loading ? <Spinner size={16} /> : <Icon {...SM} />}
                    </span>
                    <span className="cmdk-item-main">
                      <span className={`cmdk-item-label${item.mono ? ' mono' : ''}`}>{item.label}</span>
                      {item.meta && <span className="cmdk-item-meta">{item.meta}</span>}
                    </span>
                    {item.level && <RiskBadge level={item.level} size="sm" />}
                    {item.amount && <span className="cmdk-item-amount tabular-nums">{item.amount}</span>}
                    {item.keys && <kbd className="cmdk-item-keys">{item.keys}</kbd>}
                    {item.hint && !item.keys && <span className="cmdk-item-hint">{item.hint}</span>}
                    {isActive && <ArrowRight {...SM} aria-hidden="true" className="cmdk-item-go" />}
                  </div>
                );
              })}
            </div>
          ))}
          {noResults && (
            <div className="cmdk-empty" role="status">
              No transactions, customers or actions match “{trimmed}”.
            </div>
          )}
        </div>
        <div className="cmdk-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={12} strokeWidth={1.75} />
            </kbd>{' '}
            open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
}
