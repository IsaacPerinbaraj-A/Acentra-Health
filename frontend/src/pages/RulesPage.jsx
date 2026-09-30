import { useCallback, useMemo, useState } from 'react';
import { Info, Lock, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react';
import {
  Banner,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  ErrorState,
  PageHeader,
  Pill,
  Skeleton,
  SkeletonText,
  useToast,
} from '../components/ui';
import useApi from '../hooks/useApi';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { useAuth } from '../auth/AuthContext';
import { formatNumber } from '../utils/format';
import RuleCard from './rules/RuleCard';
import AddRuleModal from './rules/AddRuleModal';
import { apiFetch } from '../api/client';
import '../styles/pages/rules.css';

function RuleCardSkeleton() {
  return (
    <Card className="rules-card rules-card--skeleton" padded aria-hidden="true">
      <div className="rules-card__head">
        <div className="rules-card__ident">
          <Skeleton width={40} height={40} radius={10} />
          <div className="rules-card__titles">
            <Skeleton width={180} height={20} />
            <Skeleton width={220} height={14} />
          </div>
        </div>
        <Skeleton width={72} height={22} radius={999} />
      </div>
      <SkeletonText lines={2} />
      <div className="rules-card__stats">
        <Skeleton height={64} />
        <Skeleton height={64} />
      </div>
      <Skeleton height={56} />
      <div className="rules-params">
        <Skeleton height={60} />
        <Skeleton height={60} />
      </div>
      <div className="rules-card__footer">
        <Skeleton width={140} height={32} />
      </div>
    </Card>
  );
}

export default function RulesPage() {
  useDocumentTitle('Rules');
  const toast = useToast();
  const { hasRole } = useAuth();
  const isAdmin = !!hasRole?.('ADMIN');

  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const rulesApi = useApi('/api/rules');
  const statsApi = useApi('/api/stats');
  const perfApi = useApi('/api/rules/performance');

  const rules = rulesApi.data;

  const fireCounts = useMemo(() => {
    const map = new Map();
    (statsApi.data?.rule_fire_counts || []).forEach((r) => map.set(r.rule_name, r.count));
    return map;
  }, [statsApi.data]);

  const perfByRule = useMemo(() => {
    const map = new Map();
    (Array.isArray(perfApi.data) ? perfApi.data : []).forEach((r) => map.set(r.rule_name, r));
    return map;
  }, [perfApi.data]);

  const { setData: setRules } = rulesApi;
  const handleSaved = useCallback(
    (updated) => {
      if (!updated?.name) return;
      setRules((prev) => (Array.isArray(prev) ? prev.map((r) => (r.name === updated.name ? updated : r)) : prev));
    },
    [setRules],
  );

  const refreshAll = () => {
    rulesApi.reload();
    statsApi.reload();
    perfApi.reload();
  };
  const refreshing = rulesApi.refreshing || statsApi.refreshing || perfApi.refreshing;

  const enabledCount = Array.isArray(rules) ? rules.filter((r) => r.enabled).length : 0;
  const statsLoading = (statsApi.loading && !statsApi.data) || (perfApi.loading && !perfApi.data);

  const actions = (
    <div className="rules-header-actions">
      {Array.isArray(rules) && rules.length > 0 && (
        <Pill tone="brand">
          {formatNumber(enabledCount)} of {formatNumber(rules.length)} enabled
        </Pill>
      )}
      {!isAdmin && (
        <Pill tone="neutral" icon={Lock}>
          Read-only
        </Pill>
      )}
      <Button variant="secondary" icon={RefreshCw} onClick={refreshAll} loading={refreshing}>
        Refresh
      </Button>
      {isAdmin && (
        <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
          Add rule
        </Button>
      )}
    </div>
  );

  async function deleteRule() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await apiFetch(`/api/rules/${encodeURIComponent(deleting.name)}`, { method: 'DELETE' });
      toast({ variant: 'success', title: 'Rule deleted', message: `${deleting.display_name} was removed.` });
      setDeleting(null);
      refreshAll();
    } catch (err) {
      toast({ variant: 'error', title: 'Could not delete rule', message: err.message });
    } finally {
      setDeletingBusy(false);
    }
  }

  let body;
  if (rulesApi.loading && !rules) {
    body = (
      <div className="rules-grid" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <RuleCardSkeleton key={i} />
        ))}
      </div>
    );
  } else if (rulesApi.error && !rules) {
    body = (
      <Card>
        <ErrorState error={rulesApi.error} onRetry={() => rulesApi.reload()} title="Could not load rules" />
      </Card>
    );
  } else if (!rules || rules.length === 0) {
    body = (
      <Card>
        <EmptyState
          icon={SlidersHorizontal}
          title="No rules loaded"
          description="Add a rule file to backend/app/rules/ and restart the backend to see it here."
        />
      </Card>
    );
  } else {
    body = (
      <div className="rules-grid">
        {rules.map((rule) => (
          <RuleCard
            key={rule.name}
            rule={rule}
            fireCount={statsApi.data ? fireCounts.get(rule.name) ?? 0 : null}
            perf={perfByRule.get(rule.name) || null}
            statsLoading={statsLoading}
            isAdmin={isAdmin}
            onSaved={handleSaved}
            onDelete={isAdmin ? setDeleting : undefined}
            toast={toast}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="rules-page">
      <PageHeader title="Rules" description="Tune how each rule scores transactions" actions={actions} />

      <div className="rules-banner">
        <Banner tone="brand" icon={Info}>
          Rules are discovered automatically from <code className="rules-code">backend/app/rules/</code>. Add a file and
          restart to add a rule{isAdmin ? ', or use Add rule to create a condition rule instantly.' : '.'}
        </Banner>
      </div>

      <AddRuleModal open={adding} onClose={() => setAdding(false)} onCreated={refreshAll} toast={toast} />
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={deleteRule}
        loading={deletingBusy}
        title="Delete rule"
        message={deleting ? `Delete "${deleting.display_name}"? Its file ${deleting.module} is removed and it stops running on new transactions. Past results are kept.` : ''}
        confirmLabel="Delete rule"
        variant="danger"
      />

      {(statsApi.error || perfApi.error) && rules && (
        <div className="rules-banner">
          <Banner
            tone="warning"
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (statsApi.error) statsApi.reload();
                  if (perfApi.error) perfApi.reload();
                }}
              >
                Retry
              </Button>
            }
          >
            Rule activity and reviewer clear rates could not be loaded.
          </Banner>
        </div>
      )}

      {body}
    </div>
  );
}
