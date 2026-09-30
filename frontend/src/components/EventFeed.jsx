import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Pause, Play, Terminal } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Pill, Skeleton, Tooltip } from './ui';
import useApi from '../hooks/useApi';
import usePolling from '../hooks/usePolling';
import { formatDateTimeSeconds, formatINR, parseDate } from '../utils/format';
import '../styles/pages/data.css';

/* Event name -> category (drives the dot color). */
const CATEGORY = {
  TransactionReceived: 'transaction',
  TransactionEvaluated: 'transaction',
  FraudFlagged: 'flag',
  FlagStatusChanged: 'flag',
  HighRiskDetected: 'alert',
  NotificationProcessed: 'alert',
  TestAlertSent: 'alert',
  RuleConfigUpdated: 'rule',
  UserLoggedIn: 'login',
  DemoLoaded: 'data',
  CsvUploaded: 'data',
  DataReset: 'data',
  SimulationRun: 'data',
};

export function eventCategory(name) {
  if (CATEGORY[name]) return CATEGORY[name];
  const n = String(name || '').toLowerCase();
  if (n.includes('flag')) return 'flag';
  if (n.includes('alert') || n.includes('notif')) return 'alert';
  if (n.includes('rule')) return 'rule';
  if (n.includes('login') || n.includes('user')) return 'login';
  if (n.includes('transaction')) return 'transaction';
  return 'data';
}

function countRules(fired) {
  if (Array.isArray(fired)) return fired.length;
  if (fired && typeof fired === 'object') return Object.keys(fired).length;
  return Number(fired) || 0;
}

function rulesText(fired) {
  const n = countRules(fired);
  return `${n} ${n === 1 ? 'rule' : 'rules'} fired`;
}

function batchText(p) {
  const s = p?.summary && typeof p.summary === 'object' ? p.summary : p || {};
  const parts = [];
  if (s.processed !== undefined) parts.push(`${s.processed} processed`);
  if (s.flagged !== undefined) parts.push(`${s.flagged} flagged`);
  if (s.skipped_duplicates) parts.push(`${s.skipped_duplicates} skipped`);
  const errs = Array.isArray(s.errors) ? s.errors.length : Number(s.errors) || 0;
  if (errs) parts.push(`${errs} errors`);
  return parts.join(' · ');
}

/** One-line human summary of an event payload. */
export function summarizeEvent(ev) {
  const p = ev?.payload || {};
  switch (ev?.name) {
    case 'TransactionReceived':
      return [p.transaction_id, 'received', p.amount !== undefined ? `· ${formatINR(p.amount)}` : '', p.source ? `· ${p.source}` : '']
        .filter(Boolean)
        .join(' ');
    case 'TransactionEvaluated':
      return `${p.transaction_id} scored ${p.score ?? 0} (${p.level || '—'}) · ${rulesText(p.fired_rules)}`;
    case 'FraudFlagged':
      return `Flag #${p.flag_id} created for ${p.transaction_id} · ${p.level} (${p.score})`;
    case 'HighRiskDetected':
      return `${p.transaction_id} is ${p.level} (score ${p.score}) · flag #${p.flag_id}`;
    case 'NotificationProcessed':
      return `Alert ${p.status || '—'} via ${p.channel || '—'}${p.flag_id ? ` · flag #${p.flag_id}` : ''}${p.error ? ` · ${p.error}` : ''}`;
    case 'FlagStatusChanged':
      return `Flag #${p.flag_id} → ${p.to_status}${p.from_status ? ` (was ${p.from_status})` : ''}`;
    case 'RuleConfigUpdated':
      return `Rule ${p.rule_name} updated`;
    case 'UserLoggedIn':
      return `${p.username || `User #${p.user_id}`} signed in`;
    case 'DemoLoaded':
      return `Demo data loaded · ${batchText(p)}`;
    case 'CsvUploaded':
      return `CSV uploaded · ${batchText(p)}`;
    case 'DataReset':
      return 'Transaction data reset';
    case 'SimulationRun': {
      const n = Array.isArray(p.customer_ids) ? p.customer_ids.length : 0;
      return `Scenario ${p.scenario} · ${n} ${n === 1 ? 'customer' : 'customers'}`;
    }
    case 'TestAlertSent':
      return `Test alert ${p.status || '—'} via ${p.channel || '—'}`;
    default: {
      const entries = Object.entries(p).filter(([, v]) => v !== null && typeof v !== 'object');
      return entries
        .slice(0, 3)
        .map(([k, v]) => `${k}=${v}`)
        .join(' · ');
    }
  }
}

function clockTime(iso) {
  const d = parseDate(iso);
  if (!d) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** Stable keys: base key from content, duplicate suffix counted from the oldest event. */
function withKeys(events) {
  const counts = new Map();
  const out = new Array(events.length);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    let payloadKey = '';
    try {
      payloadKey = JSON.stringify(e.payload || {}).slice(0, 120);
    } catch {
      payloadKey = '';
    }
    const base = `${e.occurred_at}|${e.name}|${payloadKey}`;
    const n = counts.get(base) || 0;
    counts.set(base, n + 1);
    out[i] = { ...e, _key: n ? `${base}#${n}` : base };
  }
  return out;
}

export default function EventFeed({ pollMs = 3000 }) {
  const [paused, setPaused] = useState(false);
  const { data, error, loading, reload } = useApi('/api/events/recent', {
    query: { limit: 50 },
    silent: true,
  });

  usePolling(() => reload({ silent: true }), pollMs, { enabled: !paused });

  const events = useMemo(() => withKeys(Array.isArray(data) ? data : []), [data]);

  // Fade-in only for rows that appear after the first successful load.
  const seenRef = useRef(null);
  const isNew = (key) => seenRef.current !== null && !seenRef.current.has(key);
  useEffect(() => {
    if (!Array.isArray(data)) return;
    const next = seenRef.current || new Set();
    events.forEach((e) => next.add(e._key));
    seenRef.current = next;
  }, [data, events]);

  const hasData = Array.isArray(data);

  return (
    <Card
      className="event-feed"
      title="Live event feed"
      subtitle={paused ? 'Paused' : `Polling every ${Math.round(pollMs / 1000)} s`}
      icon={Terminal}
      padded={false}
      actions={
        <div className="event-feed__actions">
          {!paused && hasData && !error && <span className="event-feed__live" aria-hidden="true" />}
          {error && hasData && (
            <Pill tone="warning" size="sm">
              Reconnecting…
            </Pill>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={paused ? Play : Pause}
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      }
    >
      <div className="event-feed__body" role="log" aria-live="polite" aria-label="Live event feed">
        {loading && !hasData ? (
          <ul className="event-feed__list">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="event-row event-row--skeleton">
                <Skeleton width={8} height={8} radius="50%" />
                <div className="event-row__main">
                  <Skeleton width="55%" height={12} />
                  <Skeleton width="85%" height={12} />
                </div>
              </li>
            ))}
          </ul>
        ) : error && !hasData ? (
          <div className="event-feed__state">
            <ErrorState error={error} onRetry={() => reload()} />
          </div>
        ) : events.length === 0 ? (
          <div className="event-feed__state">
            <EmptyState icon={Terminal} title="No events yet — run a scenario" description="Events from the bus appear here as they happen." />
          </div>
        ) : (
          <ul className="event-feed__list">
            {events.map((e) => {
              const cat = eventCategory(e.name);
              const errs = Array.isArray(e.handler_errors) ? e.handler_errors : [];
              return (
                <li key={e._key} className={`event-row${isNew(e._key) ? ' is-new' : ''}${errs.length ? ' has-error' : ''}`}>
                  <span className={`event-dot event-dot--${cat}`} aria-hidden="true" />
                  <div className="event-row__main">
                    <div className="event-row__head">
                      <span className="event-row__name">{e.name}</span>
                      {errs.length > 0 && (
                        <Tooltip
                          content={
                            <div className="event-row__errors">
                              {errs.map((he, i) => (
                                <div key={i}>
                                  <strong>{he.handler}</strong>: {he.error}
                                </div>
                              ))}
                            </div>
                          }
                        >
                          <span className="event-row__error" tabIndex={0} aria-label={`${errs.length} handler error(s)`}>
                            <AlertTriangle size={12} aria-hidden="true" />
                            {errs.length}
                          </span>
                        </Tooltip>
                      )}
                      <time className="event-row__time" dateTime={e.occurred_at} title={formatDateTimeSeconds(e.occurred_at)}>
                        {clockTime(e.occurred_at)}
                      </time>
                    </div>
                    <div className="event-row__summary">{summarizeEvent(e)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
