import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  BellRing,
  Bell,
  ChevronDown,
  ChevronRight,
  Database,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sun,
} from 'lucide-react';
import Logo from './Logo.jsx';
import CommandPalette from './CommandPalette.jsx';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp.jsx';
import { Avatar, Pill, RiskBadge } from './ui';
import { useAuth, ROLE_LABELS } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import useLocalStorage from '../hooks/useLocalStorage.js';
import useHotkeys, { isMac } from '../hooks/useHotkeys.js';
import usePolling from '../hooks/usePolling.js';
import { useGlobalActivity } from '../hooks/useApi.js';
import { apiFetch } from '../api/client.js';
import { formatINR, formatNumber, relativeTime } from '../utils/format.js';
import '../styles/pages/layout.css';

const ICON = { size: 20, strokeWidth: 1.75 };
const SM = { size: 16, strokeWidth: 1.75 };
const POLL_MS = 30000;
const NARROW_QUERY = '(max-width: 1279.98px)';

const NAV_GROUPS = [
  {
    label: 'Monitor',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/flags', label: 'Flag queue', icon: ShieldAlert, pendingPill: true },
      { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
      { to: '/network', label: 'Network', icon: Network },
    ],
  },
  {
    label: 'Configure',
    items: [{ to: '/rules', label: 'Rules', icon: SlidersHorizontal }],
  },
  {
    label: 'Admin',
    roles: ['ADMIN'],
    items: [
      { to: '/alerts', label: 'Alerts', icon: BellRing },
      { to: '/audit', label: 'Audit log', icon: ScrollText },
      { to: '/data', label: 'Data & simulator', icon: Database },
    ],
  },
];

const ROLE_TONES = { ADMIN: 'brand', REVIEWER: 'info', VIEWER: 'neutral' };

/** pathname -> { crumbs: [{label, to?}], title } */
function routeInfo(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const [first, second] = parts;
  const decode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  switch (first) {
    case undefined:
      return { crumbs: [{ label: 'Monitor' }], title: 'Dashboard' };
    case 'flags':
      if (second) {
        return {
          crumbs: [{ label: 'Monitor' }, { label: 'Flag queue', to: '/flags' }],
          title: `Flag #${decode(second)}`,
        };
      }
      return { crumbs: [{ label: 'Monitor' }], title: 'Flag queue' };
    case 'transactions':
      return { crumbs: [{ label: 'Monitor' }], title: 'Transactions' };
    case 'customers':
      return {
        crumbs: [{ label: 'Monitor' }, { label: 'Customers' }],
        title: second ? decode(second) : 'Customer',
        mono: !!second,
      };
    case 'network':
      return { crumbs: [{ label: 'Monitor' }], title: 'Network' };
    case 'rules':
      return { crumbs: [{ label: 'Configure' }], title: 'Rules' };
    case 'alerts':
      return { crumbs: [{ label: 'Admin' }], title: 'Alerts' };
    case 'audit':
      return { crumbs: [{ label: 'Admin' }], title: 'Audit log' };
    case 'data':
      return { crumbs: [{ label: 'Admin' }], title: 'Data & simulator' };
    default:
      return { crumbs: [], title: 'RiskLens' };
  }
}

function useMediaQuery(query) {
  const get = () => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia(query);
    } catch {
      return undefined;
    }
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [query]);
  return matches;
}

/** Small popover state: closes on outside click and Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        const trigger = ref.current?.querySelector('[data-popover-trigger]');
        trigger?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function Sidebar({ collapsed, onToggle, isAdmin, pendingCount }) {
  const groups = NAV_GROUPS.filter((g) => !g.roles || (g.roles.includes('ADMIN') && isAdmin));
  return (
    <aside className={`app-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-label="Primary">
      <div className="app-sidebar-brand">
        <Link to="/" className="app-brand-link" aria-label="RiskLens home">
          <span className="app-brand-logo">
            <Logo size={28} />
          </span>
          {!collapsed && <span className="app-brand-name">RiskLens</span>}
        </Link>
      </div>
      <nav className="app-nav">
        {groups.map((group) => (
          <div className="app-nav-group" key={group.label}>
            {collapsed ? (
              <div className="app-nav-divider" aria-hidden="true" />
            ) : (
              <div className="app-nav-group-label">{group.label}</div>
            )}
            <ul className="app-nav-list">
              {group.items.map((item) => {
                const Icon = item.icon;
                const showPill = item.pendingPill && typeof pendingCount === 'number' && pendingCount > 0;
                const pillText = pendingCount > 999 ? '999+' : formatNumber(pendingCount);
                const aria = showPill ? `${item.label}, ${pendingCount} pending` : item.label;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => `app-nav-link${isActive ? ' is-active' : ''}`}
                      aria-label={collapsed ? aria : undefined}
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon {...ICON} aria-hidden="true" className="app-nav-icon" />
                      {!collapsed && <span className="app-nav-label">{item.label}</span>}
                      {showPill &&
                        (collapsed ? (
                          <span className="app-nav-dot" aria-hidden="true" />
                        ) : (
                          <span className="app-nav-pill tabular-nums" aria-label={`${pendingCount} pending`}>
                            {pillText}
                          </span>
                        ))}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="app-sidebar-footer">
        <button
          type="button"
          className="app-collapse-btn"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen {...ICON} aria-hidden="true" /> : <PanelLeftClose {...ICON} aria-hidden="true" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

function AlertBell({ alerts }) {
  const { open, setOpen, ref } = usePopover();
  const total = alerts?.total ?? 0;
  const items = alerts?.items || [];
  const badge = total > 99 ? '99+' : String(total);
  return (
    <div className="app-popover-wrap" ref={ref}>
      <button
        type="button"
        className="app-icon-btn"
        data-popover-trigger
        aria-label={total ? `High and critical alerts: ${total} pending` : 'Alerts: none pending'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell {...ICON} aria-hidden="true" />
        {total > 0 && <span className="app-bell-badge tabular-nums">{badge}</span>}
      </button>
      {open && (
        <div className="app-popover app-bell-popover" role="menu" aria-label="Pending high and critical flags">
          <div className="app-popover-header">
            <span className="app-popover-title">Needs attention</span>
            <span className="app-popover-sub tabular-nums">{formatNumber(total)} pending high/critical</span>
          </div>
          {items.length === 0 ? (
            <div className="app-popover-empty">No pending high or critical flags.</div>
          ) : (
            <ul className="app-bell-list">
              {items.map((f) => (
                <li key={f.id}>
                  <Link to={`/flags/${f.id}`} className="app-bell-item" role="menuitem" onClick={() => setOpen(false)}>
                    <RiskBadge level={f.risk_level} size="sm" />
                    <span className="app-bell-main">
                      <span className="app-bell-id mono">{f.transaction?.transaction_id ?? `Flag #${f.id}`}</span>
                      <span className="app-bell-meta">
                        <span className="mono">{f.transaction?.customer_id}</span>
                        {f.created_at ? ` · ${relativeTime(f.created_at)}` : ''}
                      </span>
                    </span>
                    <span className="app-bell-amount tabular-nums">
                      {f.transaction ? formatINR(f.transaction.amount, f.transaction.currency || 'INR') : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/flags?level=HIGH&level=CRITICAL"
            className="app-popover-footer-link"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            View all
            <ChevronRight {...SM} aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
}

function UserMenu({ user, onLogout, onShortcuts }) {
  const { open, setOpen, ref } = usePopover();
  if (!user) return null;
  const role = user.role;
  return (
    <div className="app-popover-wrap" ref={ref}>
      <button
        type="button"
        className="app-user-btn"
        data-popover-trigger
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Account menu for ${user.username}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={user.username} size={28} />
        <span className="app-user-name">{user.username}</span>
        <ChevronDown {...SM} aria-hidden="true" className="app-user-chevron" />
      </button>
      {open && (
        <div className="app-popover app-user-popover" role="menu" aria-label="Account">
          <div className="app-user-card">
            <Avatar name={user.username} size={36} />
            <div className="app-user-card-text">
              <span className="app-user-card-name">{user.username}</span>
              <Pill tone={ROLE_TONES[role] || 'neutral'}>{ROLE_LABELS[role] || role}</Pill>
            </div>
          </div>
          <button
            type="button"
            className="app-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onShortcuts();
            }}
          >
            <Keyboard {...SM} aria-hidden="true" />
            Keyboard shortcuts
            <kbd className="app-menu-kbd">?</kbd>
          </button>
          <button
            type="button"
            className="app-menu-item is-danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut {...SM} aria-hidden="true" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout, hasRole } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const activity = useGlobalActivity();
  const isAdmin = hasRole ? hasRole('ADMIN') : user?.role === 'ADMIN';

  /* ---------- sidebar collapse ---------- */
  const narrow = useMediaQuery(NARROW_QUERY);
  const [storedCollapsed, setStoredCollapsed] = useLocalStorage('risklens.sidebar.collapsed', false);
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  useEffect(() => {
    setNarrowExpanded(false);
  }, [narrow]);
  const collapsed = narrow ? !narrowExpanded : !!storedCollapsed;
  const toggleSidebar = useCallback(() => {
    if (narrow) setNarrowExpanded((v) => !v);
    else setStoredCollapsed((v) => !v);
  }, [narrow, setStoredCollapsed]);

  /* ---------- overlays ---------- */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  /* ---------- live counts (silent on errors) ---------- */
  const [pendingCount, setPendingCount] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const fetchCounts = useCallback(async () => {
    const [stats, flags] = await Promise.allSettled([
      apiFetch('/api/stats'),
      apiFetch('/api/flags', {
        query: { status: 'PENDING_REVIEW', level: ['HIGH', 'CRITICAL'], sort: 'newest', page_size: 5 },
      }),
    ]);
    if (stats.status === 'fulfilled' && stats.value) setPendingCount(Number(stats.value.pending_review) || 0);
    if (flags.status === 'fulfilled' && flags.value) setAlerts(flags.value);
  }, []);
  usePolling(fetchCounts, POLL_MS, { immediate: true, enabled: !!user });

  // refresh counts after navigating (decisions change them) — cheap and silent
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current !== location.pathname) {
      lastPath.current = location.pathname;
      if (user) fetchCounts().catch(() => {});
    }
  }, [location.pathname, user, fetchCounts]);

  /* ---------- hotkeys ---------- */
  useHotkeys({
    'mod+k': () => setPaletteOpen((o) => !o),
    '/': () => {
      const el = document.querySelector('[data-search-input]');
      const input = el && (el.matches('input, textarea') ? el : el.querySelector('input, textarea'));
      if (input) {
        input.focus();
        if (typeof input.select === 'function') input.select();
      } else {
        setPaletteOpen(true);
      }
    },
    '?': () => setHelpOpen(true),
    'g d': () => navigate('/'),
    'g f': () => navigate('/flags'),
    'g t': () => navigate('/transactions'),
    'g n': () => navigate('/network'),
  });

  const info = useMemo(() => routeInfo(location.pathname), [location.pathname]);
  const mainRef = useRef(null);

  return (
    <div className={`app-shell${collapsed ? ' is-collapsed' : ''}`}>
      <a href="#main-content" className="app-skip-link">
        Skip to content
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} isAdmin={isAdmin} pendingCount={pendingCount} />
      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-left">
            <nav aria-label="Breadcrumb" className="app-breadcrumb">
              <ol>
                {info.crumbs.map((c) => (
                  <li key={c.label}>
                    {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
                    <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" className="app-crumb-sep" />
                  </li>
                ))}
                <li aria-current="page">
                  <span className={`app-page-title${info.mono ? ' mono' : ''}`}>{info.title}</span>
                </li>
              </ol>
            </nav>
          </div>
          <div className="app-topbar-right">
            <button
              type="button"
              className="app-search-btn"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search and commands"
              aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
            >
              <Search {...SM} aria-hidden="true" />
              <span className="app-search-text">Search…</span>
              <kbd className="app-search-kbd">{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
            </button>
            <AlertBell alerts={alerts} />
            <button
              type="button"
              className="app-icon-btn"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              title={isDark ? 'Light theme' : 'Dark theme'}
            >
              {isDark ? <Sun {...ICON} aria-hidden="true" /> : <Moon {...ICON} aria-hidden="true" />}
            </button>
            <UserMenu user={user} onLogout={logout} onShortcuts={() => setHelpOpen(true)} />
          </div>
          <div
            className={`app-progress${activity > 0 ? ' is-active' : ''}`}
            role="progressbar"
            aria-hidden={activity > 0 ? undefined : 'true'}
            aria-label="Loading"
          >
            <span className="app-progress-bar" />
          </div>
        </header>
        <main id="main-content" className="app-content" ref={mainRef} tabIndex={-1}>
          <div className="app-content-inner">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <KeyboardShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
