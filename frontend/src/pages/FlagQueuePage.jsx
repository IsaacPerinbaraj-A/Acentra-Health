import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BellRing, Database, Download, PartyPopper, RefreshCw, SearchX, ShieldAlert } from 'lucide-react';
import {
  Banner,
  Button,
  DataTable,
  DateRange,
  EmptyState,
  FilterBar,
  IconButton,
  MultiSelect,
  PageHeader,
  RiskBadge,
  RuleChip,
  ScoreBar,
  SearchInput,
  Select,
  StatusBadge,
  Tabs,
  Tooltip,
} from '../components/ui';
import Pagination from '../components/Pagination';
import useApi from '../hooks/useApi';
import useUrlState from '../hooks/useUrlState';
import useDebounce from '../hooks/useDebounce';
import usePolling from '../hooks/usePolling';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { apiFetch, buildQuery } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { FLAG_LEVEL_OPTIONS } from '../constants/levels';
import {
  DASH,
  formatDateTime,
  formatDateTimeSeconds,
  formatDuration,
  formatINR,
  formatNumber,
  relativeTime,
  toApiDateTime,
} from '../utils/format';
import '../styles/pages/flag-queue.css';

const PAGE_SIZE = 25;
const POLL_MS = 15000;
const HIGH_CRITICAL = ['HIGH', 'CRITICAL'];

const TABS = [
  { key: 'review', label: 'Needs review', status: ['PENDING_REVIEW'] },
  { key: 'high', label: 'High & critical', status: ['PENDING_REVIEW'], levels: HIGH_CRITICAL },
  { key: 'reviewed', label: 'Reviewed', status: ['REVIEWED'] },
  { key: 'cleared', label: 'Cleared', status: ['CLEARED'] },
  { key: 'fraud', label: 'Confirmed fraud', status: ['CONFIRMED_FRAUD'] },
  { key: 'all', label: 'All', status: [] },
];
const TAB_BY_KEY = Object.fromEntries(TABS.map((t) => [t.key, t]));

const SORT_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'score', label: 'Highest score' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'amount', label: 'Largest amount' },
];

const URL_DEFAULTS = {
  tab: 'review',
  q: '',
  level: [],
  rule: '',
  from: '',
  to: '',
  sort: 'priority',
  page: 1,
};

const PENDING_IDS_QUERY = buildQuery({ status: ['PENDING_REVIEW'], sort: 'newest', page_size: 100 });

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows, filename) {
  const header = [
    'flag_id',
    'transaction_id',
    'customer_id',
    'amount',
    'currency',
    'merchant',
    'city',
    'transaction_time',
    'risk_score',
    'risk_level',
    'status',
    'fired_rules',
    'waiting_minutes',
    'flagged_at',
  ];
  const lines = [header.join(',')];
  rows.forEach((f) => {
    const t = f.transaction || {};
    lines.push(
      [
        f.id,
        t.transaction_id,
        t.customer_id,
        t.amount,
        t.currency,
        t.merchant,
        t.city,
        t.timestamp,
        f.risk_score,
        f.risk_level,
        f.status,
        (f.fired_rule_names || []).join('; '),
        f.waiting_minutes,
        f.created_at,
      ]
        .map(csvCell)
        .join(',')
    );
  });
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sameIds(a = [], b = []) {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id);
}

function RulesCell({ flag }) {
  const names = flag.fired_rule_names || [];
  const labels = flag.fired_rules || [];
  if (!names.length && !labels.length) return <span className="fq-muted">{DASH}</span>;
  const items = (names.length ? names : labels).map((name, i) => ({
    name,
    label: names.length ? labels[i] : name,
  }));
  const shown = items.slice(0, 3);
  const rest = items.slice(3);
  return (
    <div className="fq-rules">
      {shown.map((r) => (
        <RuleChip key={r.name} name={r.name} label={r.label} />
      ))}
      {rest.length > 0 && (
        <Tooltip
          content={
            <span className="fq-more-list">
              {rest.map((r) => (
                <span key={r.name}>{r.label || r.name}</span>
              ))}
            </span>
          }
        >
          <span
            className="fq-more"
            tabIndex={0}
            aria-label={`${rest.length} more rules: ${rest.map((r) => r.label || r.name).join(', ')}`}
          >
            +{rest.length}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

function WaitingCell({ flag }) {
  if (flag.status !== 'PENDING_REVIEW' || flag.waiting_minutes === null || flag.waiting_minutes === undefined) {
    return <span className="fq-muted">{DASH}</span>;
  }
  const m = Number(flag.waiting_minutes);
  const urgent = HIGH_CRITICAL.includes(flag.risk_level);
  let tone = '';
  if (urgent && m > 240) tone = 'fq-wait--crit';
  else if (urgent && m > 60) tone = 'fq-wait--warn';
  return (
    <span className={`fq-wait ${tone}`} title={`Waiting for review for ${formatDuration(m)}`}>
      {formatDuration(m)}
    </span>
  );
}

export default function FlagQueuePage() {
  useDocumentTitle('Flag queue');
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole } = useAuth();
  const isAdmin = hasRole ? hasRole('ADMIN') : false;

  const [state, setState] = useUrlState(URL_DEFAULTS);
  const tab = TAB_BY_KEY[state.tab] ? state.tab : 'review';
  const tabDef = TAB_BY_KEY[tab];

  /* ---------- search (local input, debounced into the URL) ---------- */
  const [search, setSearch] = useState(state.q);
  const debouncedSearch = useDebounce(search, 300);
  const lastWrittenQ = useRef(state.q);
  const urlQRef = useRef(state.q);
  urlQRef.current = state.q;

  useEffect(() => {
    const next = debouncedSearch.trim();
    if (next !== urlQRef.current) {
      lastWrittenQ.current = next;
      setState({ q: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => {
    if (state.q !== lastWrittenQ.current) {
      lastWrittenQ.current = state.q;
      setSearch(state.q);
    }
  }, [state.q]);

  /* ---------- query ---------- */
  const levelParam = useMemo(() => {
    if (tabDef.levels) {
      const picked = state.level.filter((l) => tabDef.levels.includes(l));
      return picked.length ? picked : tabDef.levels;
    }
    return state.level;
  }, [tabDef, state.level]);

  const query = useMemo(
    () => ({
      status: tabDef.status,
      level: levelParam,
      rule: state.rule || undefined,
      q: state.q || undefined,
      from: toApiDateTime(state.from),
      to: toApiDateTime(state.to, true),
      sort: state.sort || 'priority',
      page: state.page,
      page_size: PAGE_SIZE,
    }),
    [tabDef, levelParam, state.rule, state.q, state.from, state.to, state.sort, state.page]
  );
  const queryKey = buildQuery(query);
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  const list = useApi('/api/flags', { query });
  const stats = useApi('/api/stats');
  const highCount = useApi('/api/flags', {
    query: { status: ['PENDING_REVIEW'], level: HIGH_CRITICAL, page_size: 1 },
  });
  const rules = useApi('/api/rules');

  const rows = list.data?.items || [];
  const total = list.data?.total;
  const listRef = useRef(list.data);
  listRef.current = list.data;

  /* ---------- live polling / new-flags banner ---------- */
  const knownPending = useRef(null);
  const [newIds, setNewIds] = useState([]);

  const fetchPendingIds = useCallback(async () => {
    const res = await apiFetch(`/api/flags${PENDING_IDS_QUERY}`);
    return (res?.items || []).map((f) => f.id);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchPendingIds()
      .then((ids) => {
        if (alive && !knownPending.current) knownPending.current = new Set(ids);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fetchPendingIds]);

  const { setData: setListData, reload: reloadList } = list;
  const { reload: reloadStats } = stats;
  const { reload: reloadHigh } = highCount;

  usePolling(async () => {
    const keyAtStart = queryKeyRef.current;
    try {
      const [ids, fresh] = await Promise.all([
        fetchPendingIds(),
        apiFetch(`/api/flags${keyAtStart}`).catch(() => null),
      ]);
      if (!knownPending.current) {
        knownPending.current = new Set(ids);
      } else {
        const unseen = ids.filter((id) => !knownPending.current.has(id));
        setNewIds(unseen);
      }
      // Update in place only when the visible order is unchanged (no reshuffling under the reviewer).
      const current = listRef.current;
      if (fresh && current && keyAtStart === queryKeyRef.current && sameIds(current.items, fresh.items)) {
        setListData(fresh);
      }
    } catch {
      /* silent: the next poll will try again */
    }
    reloadStats({ silent: true });
    reloadHigh({ silent: true });
  }, POLL_MS);

  const refreshAll = useCallback(() => {
    if (knownPending.current) newIds.forEach((id) => knownPending.current.add(id));
    else knownPending.current = new Set(newIds);
    setNewIds([]);
    reloadList();
    reloadStats({ silent: true });
    reloadHigh({ silent: true });
    fetchPendingIds()
      .then((ids) => {
        knownPending.current = new Set([...(knownPending.current || []), ...ids]);
      })
      .catch(() => {});
  }, [newIds, reloadList, reloadStats, reloadHigh, fetchPendingIds]);

  /* ---------- tabs ---------- */
  const byStatus = stats.data?.flags_by_status || {};
  const statCount = (v) => (stats.data ? v ?? 0 : undefined);
  const tabs = TABS.map((t) => {
    let count;
    if (t.key === 'review') count = statCount(byStatus.PENDING_REVIEW);
    else if (t.key === 'high') count = highCount.data ? highCount.data.total ?? 0 : undefined;
    else if (t.key === 'reviewed') count = statCount(byStatus.REVIEWED);
    else if (t.key === 'cleared') count = statCount(byStatus.CLEARED);
    else if (t.key === 'fraud') count = statCount(byStatus.CONFIRMED_FRAUD);
    else count = statCount(stats.data?.total_flags);
    return { key: t.key, label: t.label, count };
  });

  /* ---------- filters ---------- */
  const ruleOptions = useMemo(
    () => [
      { value: '', label: 'All rules' },
      ...(Array.isArray(rules.data) ? rules.data : []).map((r) => ({
        value: r.name,
        label: r.display_name || r.name,
      })),
    ],
    [rules.data]
  );
  const levelOptions = tabDef.levels
    ? FLAG_LEVEL_OPTIONS.filter((o) => tabDef.levels.includes(o.value))
    : FLAG_LEVEL_OPTIONS;

  const hasActive = Boolean(
    state.q || state.level.length || state.rule || state.from || state.to || state.sort !== 'priority'
  );

  const clearFilters = () => {
    lastWrittenQ.current = '';
    setSearch('');
    setState({ q: '', level: [], rule: '', from: '', to: '', sort: 'priority' });
  };

  /* ---------- table ---------- */
  const columns = useMemo(
    () => [
      {
        key: 'risk',
        header: 'Risk',
        width: 104,
        render: (f) => <RiskBadge level={f.risk_level} />,
      },
      {
        key: 'score',
        header: 'Score',
        width: 120,
        render: (f) => <ScoreBar score={f.risk_score} level={f.risk_level} />,
      },
      {
        key: 'transaction',
        header: 'Transaction',
        nowrap: true,
        render: (f) => {
          const ts = f.transaction?.timestamp;
          return (
            <div className="fq-txn">
              <span className="fq-txn-id">{f.transaction?.transaction_id || DASH}</span>
              {ts ? (
                <Tooltip content={`${formatDateTimeSeconds(ts)} · ${relativeTime(ts)}`}>
                  <span className="fq-sub">{formatDateTime(ts)}</span>
                </Tooltip>
              ) : null}
            </div>
          );
        },
      },
      {
        key: 'customer',
        header: 'Customer',
        nowrap: true,
        render: (f) => {
          const id = f.transaction?.customer_id;
          if (!id) return <span className="fq-muted">{DASH}</span>;
          return (
            <Link
              to={`/customers/${encodeURIComponent(id)}`}
              className="fq-link"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label={`Open customer ${id}`}
            >
              {id}
            </Link>
          );
        },
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        nowrap: true,
        render: (f) => (
          <span className="fq-amount">{formatINR(f.transaction?.amount, f.transaction?.currency || 'INR')}</span>
        ),
      },
      {
        key: 'merchant',
        header: 'Merchant · City',
        render: (f) => (
          <div className="fq-merchant">
            <span className="fq-merchant-name">{f.transaction?.merchant || DASH}</span>
            {f.transaction?.city ? <span className="fq-city"> · {f.transaction.city}</span> : null}
          </div>
        ),
      },
      {
        key: 'rules',
        header: 'Rules',
        render: (f) => <RulesCell flag={f} />,
      },
      {
        key: 'status',
        header: 'Status',
        nowrap: true,
        render: (f) => <StatusBadge status={f.status} />,
      },
      {
        key: 'waiting',
        header: 'Waiting',
        align: 'right',
        nowrap: true,
        render: (f) => <WaitingCell flag={f} />,
      },
    ],
    []
  );

  const onRowClick = useCallback(
    (f) =>
      navigate(`/flags/${f.id}`, {
        state: { from: location.search, queueIds: (listRef.current?.items || []).map((r) => r.id) },
      }),
    [navigate, location.search]
  );

  /* ---------- empty states ---------- */
  const noData = stats.data && Number(stats.data.total_transactions || 0) === 0;
  let empty;
  if (hasActive) {
    empty = {
      icon: SearchX,
      title: 'No flags match these filters',
      description: 'Try widening the date range or clearing some filters.',
      action: (
        <Button variant="secondary" onClick={clearFilters}>
          Clear filters
        </Button>
      ),
    };
  } else if (noData) {
    empty = {
      icon: Database,
      title: 'No transactions yet',
      description: isAdmin
        ? 'Load the demo dataset or upload a CSV to start screening.'
        : 'An admin needs to load transactions before flags appear here.',
      action: isAdmin ? (
        <Button variant="primary" icon={Database} onClick={() => navigate('/data')}>
          Go to Data &amp; simulator
        </Button>
      ) : null,
    };
  } else if (tab === 'review' || tab === 'high') {
    empty = {
      icon: PartyPopper,
      tone: 'success',
      title: tab === 'review' ? 'Queue cleared — no flags need review' : 'No high or critical flags waiting',
      description: 'Nice work. New flags will appear here automatically.',
      action: (
        <Button variant="secondary" onClick={() => setState({ tab: 'all' })}>
          View all flags
        </Button>
      ),
    };
  } else {
    empty = {
      icon: ShieldAlert,
      title: `No ${tabDef.label.toLowerCase()} flags`,
      description: 'Flags appear here once a reviewer records this decision.',
    };
  }

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(rows, `risklens-flags-${tab}-p${state.page}-${stamp}.csv`);
  };

  const newCount = newIds.length;

  return (
    <div className="fq-page">
      <PageHeader
        title={
          <span className="fq-title">
            Flag queue
            {typeof total === 'number' ? (
              <span className="fq-title-count" aria-label={`${total} flags`}>
                {formatNumber(total)}
              </span>
            ) : null}
          </span>
        }
        description="Flagged transactions ordered by priority — review the riskiest first."
        actions={
          <div className="fq-actions">
            <IconButton icon={RefreshCw} label="Refresh queue" onClick={refreshAll} />
            <Button variant="secondary" icon={Download} onClick={exportCsv} disabled={!rows.length}>
              Export CSV
            </Button>
          </div>
        }
      />

      {newCount > 0 && (
        <div className="fq-banner" role="status" aria-live="polite">
          <Banner
            tone="brand"
            icon={BellRing}
            action={
              <Button size="sm" variant="primary" icon={RefreshCw} onClick={refreshAll}>
                Refresh
              </Button>
            }
            onDismiss={() => {
              newIds.forEach((id) => knownPending.current?.add(id));
              setNewIds([]);
            }}
          >
            <button type="button" className="fq-banner-link" onClick={refreshAll}>
              {newCount} new {newCount === 1 ? 'flag' : 'flags'} — refresh
            </button>
          </Banner>
        </div>
      )}

      <Tabs tabs={tabs} value={tab} onChange={(key) => setState({ tab: key })} />

      <FilterBar hasActive={hasActive} onClear={clearFilters}>
        <div className="fq-search">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search transaction, customer or flag id…"
          />
        </div>
        <MultiSelect
          label="Level"
          options={levelOptions}
          value={state.level}
          onChange={(level) => setState({ level })}
        />
        <Select label="Rule" options={ruleOptions} value={state.rule} onChange={(rule) => setState({ rule: rule || '' })} />
        <DateRange from={state.from} to={state.to} onChange={({ from, to }) => setState({ from: from || '', to: to || '' })} />
        <Select
          label="Sort"
          options={SORT_OPTIONS}
          value={state.sort}
          onChange={(sort) => setState({ sort: sort || 'priority' })}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey="id"
        onRowClick={onRowClick}
        getRowLevel={(f) => f.risk_level}
        loading={list.loading}
        error={list.data ? null : list.error}
        onRetry={() => list.reload()}
        empty={empty}
      />

      {list.error && list.data ? (
        <Banner tone="error" action={<Button size="sm" onClick={() => list.reload()}>Retry</Button>}>
          Couldn&apos;t refresh the queue: {list.error.message || 'request failed'}
        </Banner>
      ) : null}

      {typeof total === 'number' && total > 0 ? (
        <Pagination
          page={state.page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(page) => {
            setState({ page }, { keepPage: true });
            if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      ) : null}
    </div>
  );
}
