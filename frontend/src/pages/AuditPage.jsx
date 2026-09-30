import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import {
  Button,
  CopyButton,
  DataTable,
  FilterBar,
  PageHeader,
  SearchInput,
  Select,
  Tooltip,
} from '../components/ui';
import Pagination from '../components/Pagination';
import useApi from '../hooks/useApi';
import useUrlState from '../hooks/useUrlState';
import useDebounce from '../hooks/useDebounce';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { formatDateTime, relativeTime } from '../utils/format';
import '../styles/pages/audit.css';

const PAGE_SIZE = 25;

/** Audited events (plan 9.2, minus TransactionReceived / TransactionEvaluated) -> category. */
const EVENT_CATEGORY = {
  FraudFlagged: 'flag',
  FlagStatusChanged: 'flag',
  HighRiskDetected: 'alert',
  NotificationProcessed: 'alert',
  TestAlertSent: 'alert',
  RuleConfigUpdated: 'rule',
  DemoLoaded: 'data',
  CsvUploaded: 'data',
  DataReset: 'data',
  SimulationRun: 'data',
  UserLoggedIn: 'login',
};

const EVENT_OPTIONS = [
  { value: '', label: 'All events' },
  ...Object.keys(EVENT_CATEGORY).map((name) => ({ value: name, label: name })),
];

const STATUS_LABELS = {
  PENDING_REVIEW: 'Pending review',
  REVIEWED: 'Reviewed',
  CLEARED: 'Cleared',
  CONFIRMED_FRAUD: 'Confirmed fraud',
};

const statusLabel = (s) => STATUS_LABELS[s] || s || '—';

function EventPill({ action }) {
  const cat = EVENT_CATEGORY[action] || 'data';
  return (
    <span className={`audit-event audit-event--${cat}`}>
      <span className="audit-event__dot" aria-hidden="true" />
      {action}
    </span>
  );
}

function batchSummary(d) {
  const parts = [];
  if (d.processed != null) parts.push(`${d.processed} processed`);
  if (d.flagged != null) parts.push(`${d.flagged} flagged`);
  if (d.alerts != null) parts.push(`${d.alerts} alerts`);
  if (d.skipped_duplicates) parts.push(`${d.skipped_duplicates} duplicates skipped`);
  if (Array.isArray(d.errors) && d.errors.length) parts.push(`${d.errors.length} errors`);
  return parts.join(' · ');
}

function ruleChangeSummary(d) {
  const name = d.rule_name || 'Rule';
  const before = d.before || {};
  const after = d.after || {};
  const changes = [];
  if (before.enabled !== undefined && after.enabled !== undefined && before.enabled !== after.enabled) {
    changes.push(after.enabled ? 'enabled' : 'disabled');
  }
  if (before.score !== undefined && after.score !== undefined && before.score !== after.score) {
    changes.push(`score ${before.score} → ${after.score}`);
  }
  if (
    before.params !== undefined &&
    after.params !== undefined &&
    JSON.stringify(before.params) !== JSON.stringify(after.params)
  ) {
    changes.push('params changed');
  }
  return changes.length ? `${name}: ${changes.join(', ')}` : `${name} updated`;
}

/** One-line human summary of an audit row from its details payload. */
function summarize(row) {
  const d = row.details && typeof row.details === 'object' ? row.details : {};
  switch (row.action) {
    case 'FraudFlagged':
      return `${d.transaction_id || 'Transaction'} flagged ${d.level || ''}${d.score != null ? ` · score ${d.score}` : ''}`.trim();
    case 'HighRiskDetected':
      return `${d.level || 'High'} risk ${d.score != null ? `${d.score}/100 ` : ''}— ${d.transaction_id || `flag #${d.flag_id ?? '?'}`}`;
    case 'NotificationProcessed':
      return `Alert via ${d.channel || '?'}: ${String(d.status || '').toLowerCase() || 'unknown'}${d.error ? ` (${d.error})` : ''}`;
    case 'FlagStatusChanged':
      return `${statusLabel(d.from_status)} → ${statusLabel(d.to_status)}${d.note ? ` · “${d.note}”` : ''}`;
    case 'RuleConfigUpdated':
      return ruleChangeSummary(d);
    case 'UserLoggedIn':
      return `${d.username || row.username || 'User'} signed in`;
    case 'DemoLoaded':
      return `Demo data loaded${batchSummary(d) ? ` · ${batchSummary(d)}` : ''}`;
    case 'CsvUploaded':
      return `CSV uploaded${batchSummary(d) ? ` · ${batchSummary(d)}` : ''}`;
    case 'DataReset':
      return 'All transactional data reset';
    case 'SimulationRun': {
      const n = Array.isArray(d.customer_ids) ? d.customer_ids.length : null;
      return `Scenario ${d.scenario || '?'}${n != null ? ` · ${n} ${n === 1 ? 'customer' : 'customers'}` : ''}`;
    }
    case 'TestAlertSent':
      return `Test alert via ${d.channel || '?'}: ${String(d.status || '').toLowerCase() || 'unknown'}`;
    default: {
      const keys = Object.keys(d);
      return keys.length ? keys.slice(0, 3).map((k) => `${k}: ${formatScalar(d[k])}`).join(' · ') : '—';
    }
  }
}

function formatScalar(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return Array.isArray(v) ? `[${v.length}]` : '{…}';
  return String(v);
}

/** Resolve the entity link: explicit entity_type/entity_id first, then details fallbacks. */
function resolveEntity(row) {
  const d = row.details && typeof row.details === 'object' ? row.details : {};
  const type = (row.entity_type || '').toLowerCase();
  const id = row.entity_id;
  if (type === 'flag' && id != null) return { to: `/flags/${id}`, label: `Flag #${id}` };
  if (type === 'rule' && id != null) return { to: '/rules', label: String(id) };
  if (type === 'transaction' && id != null)
    return { to: `/transactions?q=${encodeURIComponent(id)}`, label: String(id) };
  if (d.flag_id != null) return { to: `/flags/${d.flag_id}`, label: `Flag #${d.flag_id}` };
  if (d.rule_name) return { to: '/rules', label: d.rule_name };
  if (d.transaction_id)
    return { to: `/transactions?q=${encodeURIComponent(d.transaction_id)}`, label: d.transaction_id };
  if (type && id != null) return { to: null, label: `${type} ${id}` };
  return null;
}

/* ---------- JSON syntax coloring ---------- */

const JSON_TOKEN =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJson(value) {
  let text;
  try {
    text = JSON.stringify(value ?? null, null, 2);
  } catch {
    text = String(value);
  }
  const out = [];
  let last = 0;
  let i = 0;
  text.replace(JSON_TOKEN, (match, _g, offset) => {
    if (offset > last) {
      out.push(
        <span key={`p${i++}`} className="json-punct">
          {text.slice(last, offset)}
        </span>
      );
    }
    let cls = 'json-number';
    if (match.startsWith('"')) cls = /:\s*$/.test(match) ? 'json-key' : 'json-string';
    else if (match === 'true' || match === 'false') cls = 'json-boolean';
    else if (match === 'null') cls = 'json-null';
    if (cls === 'json-key') {
      const colon = match.lastIndexOf(':');
      out.push(
        <span key={`t${i++}`} className="json-key">
          {match.slice(0, colon)}
        </span>
      );
      out.push(
        <span key={`p${i++}`} className="json-punct">
          {match.slice(colon)}
        </span>
      );
    } else {
      out.push(
        <span key={`t${i++}`} className={cls}>
          {match}
        </span>
      );
    }
    last = offset + match.length;
    return match;
  });
  if (last < text.length) {
    out.push(
      <span key={`p${i++}`} className="json-punct">
        {text.slice(last)}
      </span>
    );
  }
  return { nodes: out, text };
}

function ExpandedAudit({ row }) {
  const { nodes, text } = useMemo(() => highlightJson(row.details), [row.details]);
  return (
    <div className="audit-expanded">
      <div className="audit-expanded__head">
        <span className="audit-expanded__meta">
          Event <span className="mono">#{row.id}</span> · {formatDateTime(row.created_at)}
          {row.user_id != null ? (
            <>
              {' '}
              · user id <span className="mono">{row.user_id}</span>
            </>
          ) : null}
        </span>
        <CopyButton value={text} label="Copy JSON" />
      </div>
      <pre className="audit-json">{nodes}</pre>
    </div>
  );
}

export default function AuditPage() {
  useDocumentTitle('Audit log');

  const [filters, setFilters] = useUrlState({ action: '', username: '', page: 1 });
  const { action, username, page } = filters;

  // Username search: local input, debounced 300 ms into the URL.
  const [search, setSearch] = useState(username);
  const debounced = useDebounce(search, 300);
  const lastPushed = useRef(username);

  useEffect(() => {
    const next = debounced.trim();
    if (next !== lastPushed.current) {
      lastPushed.current = next;
      setFilters({ username: next });
    }
  }, [debounced, setFilters]);

  // External URL changes (clear filters, back/forward) -> sync the input.
  useEffect(() => {
    if (username !== lastPushed.current) {
      lastPushed.current = username;
      setSearch(username);
    }
  }, [username]);

  const list = useApi('/api/audit', {
    query: {
      action: action || undefined,
      username: username || undefined,
      page,
      page_size: PAGE_SIZE,
    },
  });

  const data = list.data;
  const rows = data?.items || [];
  const total = data?.total ?? 0;
  const hasActive = !!(action || username);

  const clearFilters = () => {
    lastPushed.current = '';
    setSearch('');
    setFilters({ action: '', username: '' });
  };

  const columns = [
    {
      key: 'created_at',
      header: 'Time',
      width: 110,
      nowrap: true,
      render: (row) => (
        <Tooltip content={formatDateTime(row.created_at)}>
          <span className="audit-time">{relativeTime(row.created_at)}</span>
        </Tooltip>
      ),
    },
    {
      key: 'action',
      header: 'Event',
      nowrap: true,
      render: (row) => <EventPill action={row.action} />,
    },
    {
      key: 'username',
      header: 'Actor',
      nowrap: true,
      render: (row) =>
        row.username ? (
          <span className="audit-actor">{row.username}</span>
        ) : (
          <span className="audit-actor audit-actor--system">system</span>
        ),
    },
    {
      key: 'entity',
      header: 'Entity',
      nowrap: true,
      render: (row) => {
        const ent = resolveEntity(row);
        if (!ent) return <span className="audit-muted">—</span>;
        if (!ent.to) return <span className="audit-entity mono">{ent.label}</span>;
        return (
          <Link to={ent.to} className="audit-entity audit-entity--link mono" onClick={(e) => e.stopPropagation()}>
            {ent.label}
          </Link>
        );
      },
    },
    {
      key: 'summary',
      header: 'Summary',
      render: (row) => {
        const s = summarize(row);
        return (
          <span className="audit-summary" title={s}>
            {s}
          </span>
        );
      },
    },
  ];

  return (
    <div className="page audit-page">
      <PageHeader title="Audit log" description="Every event recorded by the audit handler" />

      <FilterBar hasActive={hasActive} onClear={clearFilters}>
        <div className="audit-filter audit-filter--select">
          <Select
            label="Event"
            options={EVENT_OPTIONS}
            value={action}
            placeholder="All events"
            onChange={(v) => setFilters({ action: v || '' })}
          />
        </div>
        <div className="audit-filter audit-filter--search">
          <SearchInput value={search} onChange={setSearch} placeholder="Filter by username…" />
        </div>
        {data ? (
          <span className="audit-count">
            {total} {total === 1 ? 'event' : 'events'}
          </span>
        ) : null}
      </FilterBar>

      <div className={`audit-table${list.refreshing ? ' is-refreshing' : ''}`}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          loading={list.loading && !data}
          error={data ? null : list.error}
          onRetry={() => list.reload()}
          renderExpanded={(row) => <ExpandedAudit row={row} />}
          empty={
            hasActive
              ? {
                  icon: ScrollText,
                  title: 'No matching events',
                  description: 'No audit events match these filters.',
                  action: (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ),
                }
              : {
                  icon: ScrollText,
                  title: 'No audit events yet',
                  description: 'Events appear here as flags, rules, alerts and data change.',
                }
          }
        />
      </div>

      {data && total > 0 ? (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => setFilters({ page: p }, { keepPage: true })}
        />
      ) : null}
    </div>
  );
}
