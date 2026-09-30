import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  CircleDot,
  Mail,
  MessageSquare,
  Send,
  Terminal,
  XCircle,
} from 'lucide-react';
import {
  Button,
  CopyButton,
  DataTable,
  PageHeader,
  Pill,
  SegmentedControl,
  Skeleton,
  Tooltip,
  useToast,
} from '../components/ui';
import Pagination from '../components/Pagination';
import useApi, { trackActivity } from '../hooks/useApi';
import useUrlState from '../hooks/useUrlState';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime, relativeTime } from '../utils/format';
import '../styles/pages/alerts.css';

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'SENT', label: 'Sent' },
  { value: 'LOGGED', label: 'Logged' },
  { value: 'FAILED', label: 'Failed' },
];

const CHANNELS = {
  log: { icon: Terminal, label: 'Server log' },
  sns: { icon: MessageSquare, label: 'Amazon SNS' },
  ses: { icon: Mail, label: 'Amazon SES' },
};

const MODES = {
  log: { label: 'Log mode', tone: 'neutral', icon: Terminal },
  sns: { label: 'SNS', tone: 'brand', icon: MessageSquare },
  ses: { label: 'SES', tone: 'brand', icon: Mail },
};

const STATUS_META = {
  SENT: { label: 'Sent', tone: 'success', icon: CheckCircle2 },
  LOGGED: { label: 'Logged', tone: 'neutral', icon: CircleDot },
  FAILED: { label: 'Failed', tone: 'error', icon: XCircle },
};

/** Small local status badge for notification delivery status (feedback tokens). */
function AlertStatusBadge({ status, error }) {
  const meta = STATUS_META[status] || { label: status || '—', tone: 'neutral', icon: CircleDot };
  const Icon = meta.icon;
  const badge = (
    <span className={`alert-status alert-status--${meta.tone}`}>
      <Icon size={12} aria-hidden="true" />
      {meta.label}
    </span>
  );
  if (status === 'FAILED' && error) {
    return <Tooltip content={error}>{badge}</Tooltip>;
  }
  return badge;
}

function ChannelCell({ channel }) {
  const meta = CHANNELS[channel] || { icon: BellRing, label: channel || '—' };
  const Icon = meta.icon;
  return (
    <span className="alert-channel">
      <span className="alert-channel__icon" aria-hidden="true">
        <Icon size={14} />
      </span>
      <span>{meta.label}</span>
    </span>
  );
}

function ModePill({ health, loading }) {
  if (loading && !health) return <Skeleton width={84} height={22} radius={999} />;
  const mode = health?.notify_mode;
  if (!mode) return null;
  const meta = MODES[mode] || { label: String(mode).toUpperCase(), tone: 'neutral', icon: BellRing };
  return (
    <Tooltip content={`Alerts are delivered via ${CHANNELS[mode]?.label || mode}`}>
      <span>
        <Pill tone={meta.tone} icon={meta.icon}>
          {meta.label}
        </Pill>
      </span>
    </Tooltip>
  );
}

function ExpandedAlert({ row }) {
  return (
    <div className="alert-expanded">
      <div className="alert-expanded__head">
        <div className="alert-expanded__subject">{row.subject || 'No subject'}</div>
        {row.message ? <CopyButton value={row.message} label="Copy message" /> : null}
      </div>
      {row.message ? (
        <pre className="alert-expanded__message">{row.message}</pre>
      ) : (
        <div className="alert-expanded__muted">No message body recorded.</div>
      )}
      {row.error ? (
        <div className="alert-expanded__error">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{row.error}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function AlertsPage() {
  useDocumentTitle('Alerts');
  const toast = useToast();
  const { hasRole } = useAuth();
  const isAdmin = hasRole ? hasRole('ADMIN') : false;

  const [filters, setFilters] = useUrlState({ status: 'all', page: 1 });
  const { status, page } = filters;

  const health = useApi('/api/health', { silent: true });
  const list = useApi('/api/notifications', {
    query: {
      status: status === 'all' ? undefined : status,
      page,
      page_size: PAGE_SIZE,
    },
  });

  const [sending, setSending] = useState(false);

  const sendTest = useCallback(async () => {
    setSending(true);
    try {
      const res = await trackActivity(apiFetch('/api/notifications/test', { method: 'POST' }));
      const st = res?.status;
      if (st === 'FAILED') {
        toast({
          variant: 'error',
          title: 'Test alert failed',
          message: res?.error || 'The channel rejected the alert.',
        });
      } else {
        toast({
          variant: st === 'SENT' ? 'success' : 'info',
          title: st === 'SENT' ? 'Test alert sent' : 'Test alert logged',
          message:
            st === 'SENT'
              ? `Delivered via ${CHANNELS[res?.channel]?.label || res?.channel || 'channel'}${res?.target ? ` to ${res.target}` : ''}.`
              : 'Written to the server log (log mode).',
        });
      }
      list.reload();
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Could not send test alert',
        message: err?.detail || err?.message || 'Request failed',
      });
    } finally {
      setSending(false);
    }
  }, [toast, list]);

  const data = list.data;
  const rows = data?.items || [];
  const total = data?.total ?? 0;

  const columns = [
    {
      key: 'created_at',
      header: 'Time',
      width: 120,
      nowrap: true,
      render: (row) => (
        <Tooltip content={formatDateTime(row.created_at)}>
          <span className="alerts-time">{relativeTime(row.created_at)}</span>
        </Tooltip>
      ),
    },
    {
      key: 'transaction_id',
      header: 'Transaction',
      nowrap: true,
      render: (row) =>
        row.flag_id == null ? (
          <span className="alerts-test">
            <Send size={12} aria-hidden="true" />
            Test alert
          </span>
        ) : (
          <Link
            to={`/flags/${row.flag_id}`}
            className="alerts-txn mono"
            onClick={(e) => e.stopPropagation()}
          >
            {row.transaction_id || `Flag #${row.flag_id}`}
          </Link>
        ),
    },
    {
      key: 'channel',
      header: 'Channel',
      nowrap: true,
      render: (row) => <ChannelCell channel={row.channel} />,
    },
    {
      key: 'target',
      header: 'Target',
      render: (row) =>
        row.target ? (
          <Tooltip content={row.target}>
            <span className="alerts-target mono">{row.target}</span>
          </Tooltip>
        ) : (
          <span className="alerts-muted">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      nowrap: true,
      render: (row) => <AlertStatusBadge status={row.status} error={row.error} />,
    },
  ];

  const filtered = status !== 'all';

  return (
    <div className="page alerts-page">
      <PageHeader
        title="Alerts"
        description="Notifications sent for high-risk flags"
        actions={
          <div className="alerts-actions">
            <ModePill health={health.data} loading={health.loading} />
            {isAdmin ? (
              <Button variant="primary" icon={Send} loading={sending} onClick={sendTest}>
                Send test alert
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="alerts-toolbar">
        <SegmentedControl
          options={STATUS_OPTIONS}
          value={status}
          onChange={(v) => setFilters({ status: v })}
        />
        {data ? (
          <span className="alerts-count">
            {total} {total === 1 ? 'alert' : 'alerts'}
          </span>
        ) : null}
      </div>

      <div className={`alerts-table${list.refreshing ? ' is-refreshing' : ''}`}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          loading={list.loading && !data}
          error={data ? null : list.error}
          onRetry={() => list.reload()}
          renderExpanded={(row) => <ExpandedAlert row={row} />}
          empty={
            filtered
              ? {
                  icon: BellRing,
                  title: 'No matching alerts',
                  description: 'No alerts with this status. Try another filter.',
                  action: (
                    <Button variant="ghost" size="sm" onClick={() => setFilters({ status: 'all' })}>
                      Show all alerts
                    </Button>
                  ),
                }
              : {
                  icon: BellRing,
                  title: 'No alerts yet',
                  description: 'Alerts are sent for HIGH and CRITICAL flags',
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
