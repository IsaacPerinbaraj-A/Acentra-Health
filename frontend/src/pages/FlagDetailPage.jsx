import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  History,
  Lightbulb,
  Mail,
  MessageSquare,
  Network,
  PartyPopper,
  Receipt,
  SearchX,
  Terminal,
  User,
  Users,
} from 'lucide-react';
import {
  Avatar,
  Button,
  Card,
  CopyButton,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  KeyValueList,
  Pill,
  RiskBadge,
  ScoreBreakdown,
  ScoreGauge,
  Skeleton,
  SkeletonText,
  StatusBadge,
  Tooltip,
} from '../components/ui';
import { TravelEvidence, FraudRingEvidence, AmountEvidence, BalanceEvidence } from '../components/evidence';
import RuleResultsTable from '../components/RuleResultsTable';
import DecisionCard from '../components/DecisionCard';
import ActivityTimeline from '../components/ActivityTimeline';
import useApi from '../hooks/useApi';
import useHotkeys from '../hooks/useHotkeys';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { getLevelMeta, levelGte } from '../constants/levels';
import { getNotificationStatusMeta } from '../constants/statuses';
import { explainSignals, firedResults } from '../utils/explain';
import { formatDateTime, formatINR, formatNumber, relativeTime, DASH } from '../utils/format';
import '../styles/pages/flag-detail.css';

/* ---------------------------------------------------------------- helpers */

function queuePath(from) {
  if (!from || typeof from !== 'string') return '/flags';
  if (from.startsWith('/')) return from;
  if (from.startsWith('?')) return `/flags${from}`;
  return '/flags';
}

function isNum(v) {
  return v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));
}

function RelTime({ iso, prefix = '' }) {
  if (!iso) return DASH;
  return (
    <Tooltip content={formatDateTime(iso)}>
      <time dateTime={iso} tabIndex={0} className="fd-reltime">
        {prefix}
        {relativeTime(iso)}
      </time>
    </Tooltip>
  );
}

function channelIcon(channel) {
  const c = String(channel || '').toLowerCase();
  if (c.includes('ses') || c.includes('mail')) return Mail;
  if (c.includes('sns') || c.includes('sms')) return MessageSquare;
  return Terminal;
}

function channelLabel(channel) {
  const c = String(channel || '').toLowerCase();
  if (c.includes('ses') || c.includes('mail')) return 'Email (SES)';
  if (c.includes('sns') || c.includes('sms')) return 'SMS (SNS)';
  if (c.includes('log')) return 'Console log';
  return channel || 'Alert';
}

/* ---------------------------------------------------------------- skeleton */

function DetailSkeleton() {
  return (
    <div className="fd" aria-busy="true" aria-label="Loading flag">
      <div className="fd-header">
        <Skeleton width={36} height={36} radius="var(--radius-sm)" />
        <Skeleton width={180} height={28} />
        <Skeleton width={90} height={22} radius="var(--radius-full)" />
        <Skeleton width={110} height={22} radius="var(--radius-full)" />
      </div>
      <div className="fd-grid">
        <div className="fd-main">
          <Card title="Why was this flagged?">
            <SkeletonText lines={2} />
            <div className="fd-gap" />
            <Skeleton height={12} radius="var(--radius-full)" />
            <div className="fd-gap" />
            <SkeletonText lines={5} />
          </Card>
          <Card title="Transaction details">
            <SkeletonText lines={6} />
          </Card>
        </div>
        <aside className="fd-side">
          <Card>
            <div className="fd-score">
              <Skeleton width={96} height={96} radius="var(--radius-full)" />
              <SkeletonText lines={2} />
            </div>
          </Card>
          <Card title="Decision">
            <Skeleton height={80} />
            <div className="fd-gap" />
            <Skeleton height={44} />
            <div className="fd-gap-sm" />
            <Skeleton height={44} />
            <div className="fd-gap-sm" />
            <Skeleton height={44} />
          </Card>
        </aside>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- side cards */

function ScoreCard({ detail }) {
  const level = detail.level || detail.flag?.risk_level;
  const lm = getLevelMeta(level);
  const score = detail.score ?? detail.flag?.risk_score ?? 0;
  const raw = detail.raw_score;
  return (
    <Card className="fd-score-card">
      <div className="fd-score">
        <ScoreGauge score={score} level={level} size={96} />
        <div className="fd-score__text">
          <div className="fd-score__level" style={{ '--lvl': lm.color }}>
            <span className="fd-score__dot" aria-hidden="true" />
            {lm.label} risk
          </div>
          <div className="fd-score__meta">
            Flagged <RelTime iso={detail.flag?.created_at} />
          </div>
          {isNum(raw) && Number(raw) > Number(score) ? (
            <div className="fd-score__meta">
              Raw score <span className="num">{formatNumber(raw)}</span>, capped at 100
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function AlertCard({ notification, level }) {
  if (!notification) {
    const high = levelGte(level, 'HIGH');
    return (
      <Card title="Alert" icon={Bell}>
        <div className="fd-alert fd-alert--none">
          <BellOff size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{high ? 'No alert recorded for this flag' : 'No alert — below High'}</span>
        </div>
      </Card>
    );
  }
  const ChannelIcon = channelIcon(notification.channel);
  const sm = getNotificationStatusMeta(notification.status);
  const badge = (
    <Pill tone={sm.tone} icon={sm.icon}>
      {sm.label}
    </Pill>
  );
  return (
    <Card title="Alert" icon={Bell}>
      <div className="fd-alert">
        <span className="fd-alert__icon" aria-hidden="true">
          <ChannelIcon size={16} strokeWidth={1.75} />
        </span>
        <div className="fd-alert__body">
          <div className="fd-alert__row">
            <span className="fd-alert__channel">{channelLabel(notification.channel)}</span>
            {notification.status === 'FAILED' && notification.error ? (
              <Tooltip content={notification.error}>
                <span tabIndex={0} className="fd-alert__badge-wrap" aria-label={`Failed: ${notification.error}`}>
                  {badge}
                </span>
              </Tooltip>
            ) : (
              badge
            )}
          </div>
          {notification.target ? <div className="fd-alert__target mono">{notification.target}</div> : null}
          {notification.subject ? <div className="fd-alert__subject">{notification.subject}</div> : null}
          <div className="fd-alert__time">
            <RelTime iso={notification.created_at} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function CustomerCard({ summary, customerId }) {
  const id = summary?.customer_id || customerId;
  const linked = summary?.linked_customers || [];
  const devices = [...new Set(linked.flatMap((l) => l.via_device_ids || []))];
  return (
    <Card title="Customer" icon={User}>
      <div className="fd-customer">
        <div className="fd-customer__head">
          <Avatar name={id} size={40} />
          <div className="fd-customer__id">
            <Link to={`/customers/${encodeURIComponent(id)}`} className="mono fd-link">
              {id}
            </Link>
            <CopyButton value={id} label="Copy customer id" />
          </div>
        </div>
        <dl className="fd-customer__stats">
          <div>
            <dt>Transactions</dt>
            <dd className="num">{isNum(summary?.transaction_count) ? formatNumber(summary.transaction_count) : DASH}</dd>
          </div>
          <div>
            <dt>Average</dt>
            <dd className="num">{formatINR(summary?.average_amount)}</dd>
          </div>
          <div>
            <dt>Usual city</dt>
            <dd>{summary?.usual_city || DASH}</dd>
          </div>
        </dl>
        {linked.length > 0 && (
          <div className="fd-customer__linked" role="note">
            <Network size={16} strokeWidth={1.75} aria-hidden="true" />
            <div>
              <strong>
                Linked to {linked.length} customer{linked.length === 1 ? '' : 's'}
              </strong>
              {devices.length ? (
                <>
                  {' '}
                  via shared device{devices.length === 1 ? '' : 's'}{' '}
                  <span className="mono">{devices.join(', ')}</span>
                </>
              ) : null}
              <div className="fd-customer__linked-list">
                {linked.slice(0, 8).map((l) => (
                  <Link key={l.customer_id} className="mono fd-link" to={`/customers/${encodeURIComponent(l.customer_id)}`}>
                    {l.customer_id}
                  </Link>
                ))}
                {linked.length > 8 ? <span>+{linked.length - 8} more</span> : null}
              </div>
            </div>
          </div>
        )}
        <Button as={Link} to={`/customers/${encodeURIComponent(id)}`} variant="secondary" size="sm" icon={Users} fullWidth>
          View profile
        </Button>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- page */

export default function FlagDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from;
  const backTo = queuePath(from);

  const { data, error, loading, reload, setData } = useApi(id ? `/api/flags/${id}` : null, { keepPrevious: true });
  const [queueCleared, setQueueCleared] = useState(false);

  const idRef = useRef(id);
  idRef.current = id;

  useEffect(() => {
    setQueueCleared(false);
  }, [id]);

  // keep showing the old flag only while its id matches (avoid mixing flags when navigating)
  const detail = data;

  const txn = detail?.transaction || {};
  const flag = detail?.flag || {};
  const level = detail?.level || flag.risk_level;
  const results = detail?.results || [];

  useDocumentTitle(txn.transaction_id ? `Flag ${txn.transaction_id}` : 'Flag detail');

  const goTo = useCallback(
    (targetId) => {
      if (targetId === null || targetId === undefined) return;
      navigate(`/flags/${targetId}`, { state: { from } });
    },
    [navigate, from]
  );

  const goBack = useCallback(() => navigate(backTo), [navigate, backTo]);

  useHotkeys(
    {
      j: () => detail?.next_id != null && goTo(detail.next_id),
      k: () => detail?.prev_id != null && goTo(detail.prev_id),
      escape: goBack,
    },
    { enabled: true }
  );

  const handleDecided = useCallback(
    (res, meta = {}) => {
      if (meta.undo) {
        setQueueCleared(false);
        if (String(meta.flagId) !== String(idRef.current)) {
          navigate(`/flags/${meta.flagId}`, { state: { from } });
        } else if (res) {
          setData(res);
        } else {
          reload();
        }
        return;
      }
      const before = detail;
      const advance =
        meta.autoAdvance && meta.previousStatus === 'PENDING_REVIEW' && meta.status !== 'PENDING_REVIEW';
      if (advance) {
        const target = before?.next_id ?? res?.next_id ?? before?.prev_id ?? res?.prev_id ?? null;
        if (target !== null && target !== undefined && String(target) !== String(meta.flagId)) {
          if (res) setData(res);
          goTo(target);
          return;
        }
        if (res) setData(res);
        setQueueCleared(true);
        return;
      }
      if (res) setData(res);
      else reload();
    },
    [detail, from, goTo, navigate, reload, setData]
  );

  const evidence = useMemo(() => {
    const byName = {};
    firedResults(results).forEach((r) => {
      byName[r.rule_name] = r;
    });
    return byName;
  }, [results]);

  const signals = useMemo(() => explainSignals(results), [results]);

  /* ---- states ---- */

  if (queueCleared) {
    return (
      <div className="fd fd--cleared">
        <EmptyState
          icon={PartyPopper}
          tone="success"
          title="Queue cleared — no flags need review"
          description="Every pending flag has a decision. New flags will appear in the queue as transactions arrive."
          action={
            <div className="fd-cleared-actions">
              <Button variant="primary" onClick={() => navigate('/flags')}>
                Back to queue
              </Button>
              <Button variant="ghost" onClick={() => setQueueCleared(false)}>
                Stay on this flag
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  if (error && !detail) {
    if (error.status === 404) {
      return (
        <div className="fd fd--missing">
          <EmptyState
            icon={SearchX}
            title="Flag not found"
            description={`There is no flag with id ${id}. It may have been removed when data was reset.`}
            action={
              <Button as={Link} to="/flags" variant="primary" icon={ArrowLeft}>
                Back to flag queue
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <div className="fd">
        <ErrorState error={error} onRetry={() => reload()} title="Could not load this flag" />
      </div>
    );
  }

  if (loading && !detail) return <DetailSkeleton />;
  if (!detail) return <DetailSkeleton />;

  const fired = firedResults(results);
  const hasPosition = isNum(detail.queue_position) && isNum(detail.queue_total);

  const coords =
    isNum(txn.latitude) && isNum(txn.longitude)
      ? `${Number(txn.latitude).toFixed(4)}, ${Number(txn.longitude).toFixed(4)}`
      : null;

  const txnItems = [
    { label: 'Amount', value: <span className="num fd-amount">{formatINR(txn.amount, txn.currency || 'INR')}</span> },
    { label: 'Currency', value: txn.currency || 'INR' },
    { label: 'Merchant', value: txn.merchant || DASH },
    { label: 'City', value: txn.city || DASH },
    { label: 'Coordinates', value: coords || DASH, mono: !!coords },
    {
      label: 'Device',
      value: txn.device_id ? (
        <Link to={`/transactions?device_id=${encodeURIComponent(txn.device_id)}`} className="mono fd-link">
          {txn.device_id}
        </Link>
      ) : (
        DASH
      ),
    },
    {
      label: 'Balance before',
      value: <span className="num">{isNum(txn.account_balance) ? formatINR(txn.account_balance, txn.currency || 'INR') : DASH}</span>,
    },
    {
      label: 'Timestamp',
      value: txn.timestamp ? (
        <span>
          {formatDateTime(txn.timestamp)} <span className="fd-muted">· {relativeTime(txn.timestamp)}</span>
        </span>
      ) : (
        DASH
      ),
    },
    {
      label: 'Customer',
      value: txn.customer_id ? (
        <Link to={`/customers/${encodeURIComponent(txn.customer_id)}`} className="mono fd-link">
          {txn.customer_id}
        </Link>
      ) : (
        DASH
      ),
    },
    { label: 'Evaluated', value: txn.evaluated_at ? formatDateTime(txn.evaluated_at) : DASH },
  ];

  const historyColumns = [
    {
      key: 'transaction_id',
      header: 'Transaction',
      mono: true,
      nowrap: true,
      render: (r) => <span className="mono">{r.transaction_id}</span>,
    },
    { key: 'timestamp', header: 'Time', nowrap: true, render: (r) => <RelTime iso={r.timestamp} /> },
    {
      key: 'merchant',
      header: 'Merchant · City',
      render: (r) => (
        <span className="fd-ellipsis">
          {[r.merchant, r.city].filter(Boolean).join(' · ') || DASH}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      nowrap: true,
      render: (r) => <span className="num">{formatINR(r.amount, r.currency || 'INR')}</span>,
    },
    {
      key: 'risk_level',
      header: 'Risk',
      nowrap: true,
      render: (r) => (r.risk_level ? <RiskBadge level={r.risk_level} size="sm" /> : DASH),
    },
  ];

  const customerId = txn.customer_id || detail.customer_summary?.customer_id;

  return (
    <div className="fd">
      {/* ---- header strip ---- */}
      <header className="fd-header">
        <IconButton icon={ArrowLeft} label="Back to queue (Esc)" onClick={goBack} />
        <div className="fd-header__title">
          <h1 className="fd-header__id mono">{txn.transaction_id || `Flag ${flag.id}`}</h1>
          {txn.transaction_id ? <CopyButton value={txn.transaction_id} label="Copy transaction id" /> : null}
        </div>
        <RiskBadge level={level} />
        <StatusBadge status={flag.status} />
        <div className="fd-header__nav">
          <span className="fd-header__pos">
            {hasPosition ? (
              <>
                Flag <span className="num">{detail.queue_position}</span> of{' '}
                <span className="num">{detail.queue_total}</span> in queue
              </>
            ) : (
              'Not in the review queue'
            )}
          </span>
          <IconButton
            icon={ChevronUp}
            label="Previous flag (K)"
            disabled={detail.prev_id == null}
            onClick={() => goTo(detail.prev_id)}
          />
          <IconButton
            icon={ChevronDown}
            label="Next flag (J)"
            disabled={detail.next_id == null}
            onClick={() => goTo(detail.next_id)}
          />
        </div>
      </header>

      <div className="fd-grid">
        {/* ---- right panel (first in DOM so it sits on top in one-column mode) ---- */}
        <aside className="fd-side" aria-label="Review panel">
          <ScoreCard detail={detail} />
          <DecisionCard detail={detail} onDecided={handleDecided} />
          <AlertCard notification={detail.notification} level={level} />
          {customerId ? <CustomerCard summary={detail.customer_summary} customerId={customerId} /> : null}
          <Card title="Activity" icon={History}>
            <ActivityTimeline actions={detail.review_actions || []} createdAt={flag.created_at} />
          </Card>
        </aside>

        {/* ---- main column ---- */}
        <div className="fd-main">
          <Card
            title="Why was this flagged?"
            icon={Lightbulb}
            subtitle={`${fired.length} of ${results.length} rules fired`}
          >
            <p className="fd-explain">
              {signals.length ? (
                <>
                  <strong>
                    {signals.length} risk signal{signals.length === 1 ? '' : 's'}:
                  </strong>{' '}
                  {signals.map((s, i) => (
                    <span key={s.name}>
                      <span className="fd-explain__signal">{s.text}</span>
                      {i < signals.length - 1 ? ', ' : '.'}
                    </span>
                  ))}
                </>
              ) : (
                'No risk signals fired — every rule passed for this transaction.'
              )}
            </p>
            {fired.length ? (
              <div className="fd-breakdown">
                <ScoreBreakdown results={fired} score={detail.score} rawScore={detail.raw_score} />
              </div>
            ) : null}
            <RuleResultsTable results={results} level={level} />
          </Card>

          {evidence.impossible_travel ? <TravelEvidence result={evidence.impossible_travel} level={level} /> : null}
          {evidence.shared_device ? (
            <FraudRingEvidence result={evidence.shared_device} level={level} customerId={customerId} />
          ) : null}
          {evidence.unusual_amount ? (
            <AmountEvidence
              result={evidence.unusual_amount}
              history={detail.recent_history || []}
              transaction={txn}
              level={level}
            />
          ) : null}
          {evidence.balance_drain ? <BalanceEvidence result={evidence.balance_drain} level={level} /> : null}

          <Card title="Transaction details" icon={Receipt}>
            <KeyValueList items={txnItems} columns={2} />
          </Card>

          <Card
            title="Recent customer activity"
            subtitle="Last 10 transactions before this one"
            icon={History}
            padded={false}
            actions={
              customerId ? (
                <Link to={`/customers/${encodeURIComponent(customerId)}`} className="fd-link fd-card-link">
                  View all
                </Link>
              ) : null
            }
          >
            <DataTable
              compact
              columns={historyColumns}
              rows={detail.recent_history || []}
              rowKey="transaction_id"
              getRowLevel={(r) => (r.flag_id ? r.risk_level : null)}
              onRowClick={(r) =>
                r.flag_id
                  ? navigate(`/flags/${r.flag_id}`, { state: { from } })
                  : navigate(`/transactions?q=${encodeURIComponent(r.transaction_id)}`)
              }
              empty={{
                icon: History,
                title: 'No earlier transactions',
                description: "This is the customer's first transaction on record.",
              }}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
