import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Database,
  FileText,
  Info,
  Lock,
  Network,
  PlayCircle,
  RotateCcw,
  UploadCloud,
  Upload,
  UserX,
  X,
} from 'lucide-react';
import {
  Button,
  Card,
  ConfirmModal,
  CopyButton,
  DataTable,
  EmptyState,
  IconButton,
  PageHeader,
  RiskBadge,
  Spinner,
  useToast,
} from '../components/ui';
import EventFeed from '../components/EventFeed';
import useApi, { trackActivity } from '../hooks/useApi';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { apiFetch } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { getRuleMeta } from '../constants/ruleMeta';
import { maxLevel, normalizeLevel } from '../constants/levels';
import { formatBytes, formatNumber } from '../utils/format';
import '../styles/pages/data.css';

const MAX_BYTES = 5 * 1024 * 1024;
const CSV_HEADER =
  'transaction_id,customer_id,amount,currency,merchant,city,latitude,longitude,timestamp,device_id,account_balance';

/* Section 17 fallback when GET /api/admin/scenarios is unavailable. */
const LOCAL_SCENARIOS = [
  { key: 'normal', name: 'Normal customer', description: '4 small payments in the same city, hours apart', expected_level: 'LOW' },
  { key: 'velocity', name: 'Velocity burst', description: '6 payments 90 seconds apart after a quiet day', expected_level: 'MEDIUM' },
  { key: 'unusual_amount', name: 'Unusual amount', description: '₹40,000 after a history of ~₹1,000 payments', expected_level: 'MEDIUM' },
  { key: 'impossible_travel', name: 'Impossible travel', description: 'Chennai, then Delhi 30 minutes later', expected_level: 'HIGH' },
  { key: 'balance_drain', name: 'Balance drain', description: '₹8,500 spent from a ₹10,000 balance', expected_level: 'MEDIUM' },
  { key: 'high_risk_merchant', name: 'High-risk merchant', description: '₹5,000 at a watch-listed crypto exchange', expected_level: 'LOW' },
  { key: 'fraud_ring', name: 'Fraud ring', description: '4 new customers sharing one device', expected_level: 'MEDIUM' },
  { key: 'account_takeover', name: 'Account takeover', description: '₹60,000 gift cards in a new city, balance drained', expected_level: 'CRITICAL' },
];

const LOCAL_BY_KEY = Object.fromEntries(LOCAL_SCENARIOS.map((s) => [s.key, s]));

function scenarioVisual(key) {
  if (key === 'normal') return { icon: Activity, color: 'var(--success)' };
  if (key === 'fraud_ring') return { icon: Network, color: 'var(--rule-shared-device)' };
  if (key === 'account_takeover') return { icon: UserX, color: 'var(--level-critical)' };
  const meta = getRuleMeta(key);
  return { icon: meta.icon, color: `var(${meta.cssVar})` };
}

/** "MEDIUM on the 5th and 6th" -> "MEDIUM" */
function parseExpected(value) {
  const first = String(value || '').trim().split(/[\s(]/)[0];
  return normalizeLevel(first) || 'LOW';
}

/* ------------------------------------------------------------------ */

function SummaryKpis({ summary }) {
  const errors = Array.isArray(summary?.errors) ? summary.errors.length : Number(summary?.errors) || 0;
  const items = [
    { label: 'Processed', value: summary?.processed ?? 0, tone: '' },
    { label: 'Flagged', value: summary?.flagged ?? 0, tone: 'flagged' },
    { label: 'Alerts', value: summary?.alerts ?? 0, tone: 'alerts' },
    { label: 'Skipped duplicates', value: summary?.skipped_duplicates ?? 0, tone: '' },
    { label: 'Errors', value: errors, tone: errors > 0 ? 'errors' : '' },
  ];
  return (
    <dl className="data-kpis">
      {items.map((it) => (
        <div key={it.label} className={`data-kpi${it.tone ? ` data-kpi--${it.tone}` : ''}`}>
          <dt className="data-kpi__label">{it.label}</dt>
          <dd className="data-kpi__value">{formatNumber(it.value, 0)}</dd>
        </div>
      ))}
    </dl>
  );
}

const ERROR_COLUMNS = [
  { key: 'row', header: 'Row', align: 'right', width: 72, render: (r) => <span className="tabular">{r.row ?? '—'}</span> },
  {
    key: 'transaction_id',
    header: 'Transaction',
    mono: true,
    nowrap: true,
    width: 180,
    render: (r) => r.transaction_id || '—',
  },
  { key: 'error', header: 'Error', render: (r) => <span className="data-error-text">{r.error}</span> },
];

function TxnList({ rows }) {
  const columns = [
    {
      key: 'transaction_id',
      header: 'Transaction',
      mono: true,
      nowrap: true,
      render: (r) => (
        <span className="data-id">
          {r.transaction_id}
          <CopyButton value={r.transaction_id} label="Copy transaction id" />
        </span>
      ),
    },
    {
      key: 'customer_id',
      header: 'Customer',
      nowrap: true,
      render: (r) => (
        <Link className="data-link mono" to={`/customers/${encodeURIComponent(r.customer_id)}`}>
          {r.customer_id}
        </Link>
      ),
    },
    { key: 'score', header: 'Score', align: 'right', width: 80, render: (r) => <span className="tabular">{r.score}</span> },
    { key: 'level', header: 'Risk', width: 110, render: (r) => <RiskBadge level={r.level} size="sm" /> },
    {
      key: 'flag_id',
      header: 'Flag',
      align: 'right',
      width: 90,
      nowrap: true,
      render: (r) =>
        r.flag_id ? (
          <Link className="data-link" to={`/flags/${r.flag_id}`}>
            Flag <ArrowRight size={12} aria-hidden="true" />
          </Link>
        ) : (
          <span className="text-3">—</span>
        ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey="transaction_id"
      compact
      getRowLevel={(r) => (r.flag_id ? r.level : null)}
      empty={{ icon: Database, title: 'No transactions created' }}
    />
  );
}

/* ------------------------------------------------------------------ */

function ImportCard() {
  const toast = useToast();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  const choose = (f) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) {
      setFile(null);
      setFileError('Only .csv files are accepted.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setFile(null);
      setFileError(`${f.name} is ${formatBytes(f.size)} — the limit is 5 MB.`);
      return;
    }
    setFileError('');
    setFile(f);
  };

  const openPicker = () => inputRef.current?.click();

  const clear = (e) => {
    e?.stopPropagation();
    setFile(null);
    setFileError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const summary = await trackActivity(apiFetch('/api/transactions/upload', { method: 'POST', formData: fd }));
      setResult({ ...summary, fileName: file.name });
      const errs = summary?.errors?.length || 0;
      toast({
        variant: errs ? 'info' : 'success',
        title: 'CSV processed',
        message: `${summary?.processed ?? 0} processed · ${summary?.flagged ?? 0} flagged · ${summary?.skipped_duplicates ?? 0} skipped${errs ? ` · ${errs} errors` : ''}`,
      });
      clear();
    } catch (err) {
      toast({ variant: 'error', title: 'Upload failed', message: err.message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card
      title="Import"
      subtitle="Upload a CSV of transactions — each row is scored by the rule engine"
      icon={UploadCloud}
      actions={
        <Button variant="primary" icon={Upload} loading={uploading} disabled={!file || uploading} onClick={upload}>
          Upload
        </Button>
      }
    >
      <div
        className={`dropzone${dragOver ? ' is-over' : ''}${file ? ' has-file' : ''}${fileError ? ' has-error' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Choose a CSV file to upload"
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          choose(e.dataTransfer?.files?.[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => choose(e.target.files?.[0])}
        />
        {file ? (
          <div className="dropzone__file">
            <FileText size={20} aria-hidden="true" className="dropzone__file-icon" />
            <div className="dropzone__file-meta">
              <span className="dropzone__file-name">{file.name}</span>
              <span className="dropzone__file-size">{formatBytes(file.size)}</span>
            </div>
            <IconButton icon={X} label="Remove file" size="sm" onClick={clear} />
          </div>
        ) : (
          <div className="dropzone__prompt">
            <UploadCloud size={28} aria-hidden="true" className="dropzone__icon" />
            <span className="dropzone__title">
              {dragOver ? 'Drop to select' : 'Drop a CSV here or click to choose'}
            </span>
            <span className="dropzone__hint">.csv up to 5 MB</span>
          </div>
        )}
      </div>
      {fileError && (
        <p className="data-field-error" role="alert">
          {fileError}
        </p>
      )}

      <div className="csv-hint">
        <span className="csv-hint__label">Header</span>
        <code className="csv-hint__code">{CSV_HEADER}</code>
        <CopyButton value={CSV_HEADER} label="Copy header" />
      </div>

      {result && (
        <div className="data-result">
          <div className="data-result__head">
            <span className="data-result__title">Result</span>
            <span className="data-result__sub mono">{result.fileName}</span>
          </div>
          <SummaryKpis summary={result} />
          {result.errors?.length > 0 && (
            <DataTable
              columns={ERROR_COLUMNS}
              rows={result.errors}
              rowKey={(r) => `${r.row}-${r.transaction_id}-${r.error}`}
              compact
            />
          )}
        </div>
      )}
    </Card>
  );
}

function DemoCard({ onReset }) {
  const toast = useToast();
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [summary, setSummary] = useState(null);

  const loadDemo = async () => {
    setLoadingDemo(true);
    try {
      const s = await trackActivity(apiFetch('/api/admin/demo/load', { method: 'POST' }));
      setSummary(s);
      const fresh = (s?.processed ?? 0) > 0;
      toast({
        variant: fresh ? 'success' : 'info',
        title: fresh ? 'Demo data loaded' : 'Demo data already loaded',
        message: `${s?.processed ?? 0} processed · ${s?.flagged ?? 0} flagged · ${s?.alerts ?? 0} alerts · ${s?.skipped_duplicates ?? 0} skipped duplicates`,
      });
    } catch (err) {
      toast({ variant: 'error', title: 'Could not load demo data', message: err.message });
    } finally {
      setLoadingDemo(false);
    }
  };

  const reset = async () => {
    setResetting(true);
    try {
      const res = await trackActivity(apiFetch('/api/admin/reset', { method: 'POST' }));
      const d = res?.deleted || {};
      setSummary(null);
      setConfirmOpen(false);
      onReset?.();
      toast({
        variant: 'success',
        title: 'Data reset',
        message: `Deleted ${d.transactions ?? 0} transactions, ${d.fraud_flags ?? 0} flags, ${d.rule_results ?? 0} rule results, ${d.review_actions ?? 0} review actions, ${d.notifications ?? 0} notifications.`,
      });
    } catch (err) {
      toast({ variant: 'error', title: 'Reset failed', message: err.message });
    } finally {
      setResetting(false);
    }
  };

  return (
    <Card title="Demo data" subtitle="32 sample transactions with 9 flags and a fraud ring" icon={Database}>
      <div className="demo-actions">
        <Button variant="primary" icon={Database} loading={loadingDemo} onClick={loadDemo}>
          Load demo
        </Button>
        <Button variant="danger" icon={RotateCcw} disabled={resetting} onClick={() => setConfirmOpen(true)}>
          Reset data
        </Button>
      </div>
      <p className="demo-note">
        <Info size={14} aria-hidden="true" />
        Reset deletes transactions, flags, rule results, review actions and notifications. Users, rule settings and
        the audit log are kept.
      </p>
      {summary && (
        <div className="data-result">
          <SummaryKpis summary={summary} />
        </div>
      )}
      <ConfirmModal
        open={confirmOpen}
        onClose={() => !resetting && setConfirmOpen(false)}
        onConfirm={reset}
        title="Reset all transaction data?"
        message="This permanently deletes every transaction, flag, rule result, review action and notification. Users, rule settings and the audit log are kept. Type RESET to confirm."
        confirmLabel="Reset data"
        variant="danger"
        requireText="RESET"
        loading={resetting}
      />
    </Card>
  );
}

function SimulatorCard({ resetToken }) {
  const toast = useToast();
  const { data } = useApi('/api/admin/scenarios', { silent: true });
  const [running, setRunning] = useState(null);
  const [run, setRun] = useState(null);

  // Clear the last run when data is reset.
  const lastReset = useRef(resetToken);
  if (lastReset.current !== resetToken) {
    lastReset.current = resetToken;
    if (run) setRun(null);
  }

  const scenarios = useMemo(() => {
    const list = Array.isArray(data) && data.length ? data : LOCAL_SCENARIOS;
    return list.map((s) => {
      const local = LOCAL_BY_KEY[s.key] || {};
      return {
        key: s.key,
        name: s.name || local.name || s.key,
        description: s.description || local.description || '',
        expected: parseExpected(s.expected_level || local.expected_level),
        ...scenarioVisual(s.key),
      };
    });
  }, [data]);

  const simulate = async (sc) => {
    if (running) return;
    setRunning(sc.key);
    try {
      const res = await trackActivity(apiFetch('/api/admin/simulate', { method: 'POST', body: { scenario: sc.key } }));
      const txns = Array.isArray(res?.transactions) ? res.transactions : [];
      setRun({ scenario: sc, customers: res?.customer_ids || [], transactions: txns });
      const flagged = txns.filter((t) => t.flag_id).length;
      const top = maxLevel(txns.map((t) => t.level)) || 'LOW';
      toast({
        variant: 'success',
        title: `${sc.name} simulated`,
        message: `${txns.length} transactions · ${flagged} flagged · highest ${top}`,
      });
    } catch (err) {
      toast({ variant: 'error', title: `${sc.name} failed`, message: err.message });
    } finally {
      setRunning(null);
    }
  };

  return (
    <Card title="Simulator" subtitle="Run a fraud scenario against fresh SIM customers" icon={PlayCircle}>
      <div className="scenario-grid">
        {scenarios.map((sc) => {
          const Icon = sc.icon;
          const busy = running === sc.key;
          return (
            <button
              key={sc.key}
              type="button"
              className={`scenario-tile${busy ? ' is-running' : ''}`}
              style={{ '--tile-color': sc.color }}
              onClick={() => simulate(sc)}
              disabled={!!running}
              aria-busy={busy}
            >
              <span className="scenario-tile__icon" aria-hidden="true">
                {busy ? <Spinner size={16} /> : <Icon size={18} />}
              </span>
              <span className="scenario-tile__name">{sc.name}</span>
              <span className="scenario-tile__desc">{sc.description}</span>
              <span className="scenario-tile__expected">
                Expected: <RiskBadge level={sc.expected} size="sm" />
              </span>
            </button>
          );
        })}
      </div>

      {run && (
        <div className="data-result">
          <div className="data-result__head">
            <span className="data-result__title">Last run: {run.scenario.name}</span>
            <span className="data-result__sub">
              {run.transactions.length} transactions · {run.customers.length}{' '}
              {run.customers.length === 1 ? 'customer' : 'customers'}
            </span>
          </div>
          <TxnList rows={run.transactions} />
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export default function DataPage() {
  useDocumentTitle('Data & simulator');
  const { hasRole } = useAuth();
  const [resetToken, setResetToken] = useState(0);
  const isAdmin = hasRole ? hasRole('ADMIN') : false;

  return (
    <div className="data-page">
      <PageHeader title="Data & simulator" description="Load data, run fraud scenarios and watch the event bus" />
      {!isAdmin ? (
        <EmptyState
          icon={Lock}
          title="Admins only"
          description="Loading data, resetting and running the simulator require the Admin role."
        />
      ) : (
        <div className="data-page__grid">
          <div className="data-page__main">
            <ImportCard />
            <DemoCard onReset={() => setResetToken((n) => n + 1)} />
            <SimulatorCard resetToken={resetToken} />
          </div>
          <aside className="data-page__side">
            <EventFeed pollMs={3000} />
          </aside>
        </div>
      )}
    </div>
  );
}
