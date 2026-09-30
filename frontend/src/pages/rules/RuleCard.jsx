import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, FlaskConical, Info, Lock, RotateCcw, Save, Trash2, Undo2 } from 'lucide-react';
import {
  Banner,
  Button,
  Card,
  ConfirmModal,
  CopyButton,
  Input,
  NumberInput,
  Pill,
  Skeleton,
  Slider,
  Switch,
  Tooltip,
} from '../../components/ui';
import { apiFetch } from '../../api/client';
import { getRuleMeta } from '../../constants/ruleMeta';
import { formatDateTime, formatNumber, formatPercent, pluralize, relativeTime } from '../../utils/format';
import BacktestPanel from './BacktestPanel';
import { diffDraft, formatDefault, humanizeKey, paramKeys, paramStep, paramType, toDraft } from './ruleDraft';

function errorMessage(err) {
  return err?.message || 'Request failed';
}

function ParamField({ rule, name, type, value, error, disabled, onChange }) {
  const label = humanizeKey(name);
  const def = rule.default_params?.[name];
  const hint = `Default: ${formatDefault(type, def)}`;

  if (type === 'boolean') {
    return (
      <div className="rules-param rules-param--switch">
        <Switch checked={!!value} onChange={onChange} label={label} disabled={disabled} />
        <span className="rules-param__hint">{hint}</span>
      </div>
    );
  }
  if (type === 'number') {
    return (
      <div className="rules-param">
        <NumberInput
          label={label}
          value={value}
          onChange={onChange}
          step={paramStep(rule, name)}
          disabled={disabled}
        />
        {error ? (
          <span className="rules-param__error" role="alert">{error}</span>
        ) : (
          <span className="rules-param__hint">{hint}</span>
        )}
      </div>
    );
  }
  return (
    <div className={`rules-param${type === 'list' || type === 'json' ? ' rules-param--wide' : ''}`}>
      <Input
        label={type === 'list' ? `${label} (comma-separated)` : label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        error={error}
        hint={error ? undefined : hint}
        className={type === 'json' ? 'rules-mono' : undefined}
        spellCheck={false}
      />
    </div>
  );
}

function ClearRate({ perf, loading }) {
  if (loading) return <Skeleton width={72} height={22} />;
  const cleared = perf?.cleared || 0;
  const confirmed = perf?.confirmed_fraud || 0;
  const decided = cleared + confirmed;
  const rate = perf?.clear_rate;
  const hasRate = rate !== null && rate !== undefined;
  return (
    <>
      <span className="rules-stat__value">{hasRate ? formatPercent(rate) : '—'}</span>
      <span className="rules-stat__sub">
        {formatNumber(cleared)} cleared · {formatNumber(confirmed)} confirmed fraud
      </span>
      <span className="rules-stat__bar" aria-hidden="true">
        {decided > 0 && (
          <>
            <span className="rules-stat__bar-cleared" style={{ width: `${(cleared / decided) * 100}%` }} />
            <span className="rules-stat__bar-fraud" style={{ width: `${(confirmed / decided) * 100}%` }} />
          </>
        )}
      </span>
    </>
  );
}

/**
 * One editable rule card.
 * Props: rule (RuleOut), fireCount (number|null), perf (performance row|null),
 * statsLoading, isAdmin, onSaved(RuleOut), toast (useToast fn).
 */
export default function RuleCard({ rule, fireCount, perf, statsLoading, isAdmin, onSaved, onDelete, toast }) {
  const meta = getRuleMeta(rule.name, rule.display_name);
  const Icon = meta.icon;
  const signature = `${rule.updated_at || ''}|${rule.enabled}|${rule.score}|${JSON.stringify(rule.params || {})}`;

  const [draft, setDraft] = useState(() => toDraft(rule));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [backtest, setBacktest] = useState(null);

  // Server copy changed (save / reset / refresh) -> start from the new values.
  useEffect(() => {
    setDraft(toDraft(rule));
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const diff = useMemo(() => diffDraft(rule, draft), [rule, draft]);
  const keys = useMemo(() => paramKeys(rule), [rule]);
  const readOnly = !isAdmin;
  const busy = saving || testing || resetting;

  const update = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setBacktest(null);
    setServerError(null);
  };
  const updateParam = (key, value) => {
    setDraft((d) => ({ ...d, params: { ...d.params, [key]: value } }));
    setBacktest(null);
    setServerError(null);
  };

  const handleScore = (n) => {
    if (typeof n === 'number' && Number.isFinite(n)) update({ score: Math.max(0, Math.min(100, n)) });
    else update({ score: n });
  };

  const handleSave = async () => {
    if (diff.hasErrors || !Object.keys(diff.changes).length) return;
    setSaving(true);
    setServerError(null);
    try {
      const updated = await apiFetch(`/api/rules/${encodeURIComponent(rule.name)}`, {
        method: 'PATCH',
        body: diff.changes,
      });
      setBacktest(null);
      onSaved?.(updated);
      toast?.({ variant: 'success', title: 'Rule saved', message: `${meta.displayName} updated.` });
    } catch (err) {
      const msg = errorMessage(err);
      setServerError(msg);
      toast?.({ variant: 'error', title: 'Could not save rule', message: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (diff.hasErrors || !Object.keys(diff.changes).length) return;
    setTesting(true);
    setServerError(null);
    try {
      const res = await apiFetch('/api/rules/backtest', {
        method: 'POST',
        body: { overrides: { [rule.name]: diff.changes } },
      });
      setBacktest(res);
    } catch (err) {
      const msg = errorMessage(err);
      setServerError(msg);
      toast?.({ variant: 'error', title: 'Backtest failed', message: msg });
    } finally {
      setTesting(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setServerError(null);
    try {
      const updated = await apiFetch(`/api/rules/${encodeURIComponent(rule.name)}/reset`, { method: 'POST' });
      setConfirmReset(false);
      setBacktest(null);
      setDraft(toDraft(updated));
      onSaved?.(updated);
      toast?.({ variant: 'success', title: 'Rule reset', message: `${meta.displayName} is back to its defaults.` });
    } catch (err) {
      const msg = errorMessage(err);
      setServerError(msg);
      setConfirmReset(false);
      toast?.({ variant: 'error', title: 'Could not reset rule', message: msg });
    } finally {
      setResetting(false);
    }
  };

  const discard = () => {
    setDraft(toDraft(rule));
    setBacktest(null);
    setServerError(null);
  };

  const disabled = !draft.enabled;
  const className = [
    'rules-card',
    diff.dirty && !readOnly ? 'is-dirty' : '',
    disabled ? 'is-disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const scoreValid = typeof draft.score === 'number' && Number.isFinite(draft.score);

  return (
    <Card className={className} padded style={{ '--rule-color': `var(${meta.cssVar})` }}>
      <div className="rules-card__head">
        <div className="rules-card__dim rules-card__ident">
          <span className="rules-card__icon" aria-hidden="true">
            <Icon size={20} />
          </span>
          <div className="rules-card__titles">
            <h3 className="rules-card__name">
              {meta.displayName}
              {disabled && <Pill tone="neutral">Disabled</Pill>}
              {diff.dirty && !readOnly && (
                <Pill tone="warning" icon={AlertTriangle}>
                  Unsaved
                </Pill>
              )}
            </h3>
            <div className="rules-card__ids">
              <span className="rules-mono rules-card__id">{rule.name}</span>
              <CopyButton value={rule.name} label="Copy rule id" />
              {rule.module && (
                <span className="rules-mono rules-card__module" title={rule.module}>
                  {rule.module}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="rules-card__toggle">
          <Switch
            checked={draft.enabled}
            onChange={(v) => update({ enabled: v })}
            label={draft.enabled ? 'Enabled' : 'Off'}
            disabled={readOnly || busy}
          />
        </div>
      </div>

      <div className="rules-card__dim">
        {rule.description && <p className="rules-card__desc">{rule.description}</p>}

        <div className="rules-card__stats">
          <div className="rules-stat">
            <span className="rules-stat__label">
              <Activity size={14} aria-hidden="true" />
              Activity
            </span>
            {statsLoading ? (
              <Skeleton width={96} height={22} />
            ) : (
              <span className="rules-stat__value">
                {fireCount == null ? '—' : `Fired ${pluralize(fireCount, 'time', 'times')}`}
              </span>
            )}
            <span className="rules-stat__sub">
              {perf ? `${formatNumber(perf.fired_on_flags || 0)} on flags · ${formatNumber(perf.pending || 0)} pending` : ' '}
            </span>
          </div>
          <div className="rules-stat">
            <span className="rules-stat__label">
              Reviewer clear rate
              <Tooltip content="A high clear rate suggests the rule is too strict">
                <span className="rules-stat__info" tabIndex={0} aria-label="About reviewer clear rate">
                  <Info size={13} aria-hidden="true" />
                </span>
              </Tooltip>
            </span>
            <ClearRate perf={perf} loading={statsLoading} />
          </div>
        </div>

        <div className="rules-card__section">
          <div className="rules-card__section-head">
            <span className="rules-card__section-title">Points</span>
            <span className="rules-card__section-hint">Default: {formatNumber(rule.default_score)}</span>
          </div>
          <div className="rules-points">
            <div className="rules-points__input">
              <NumberInput
                value={draft.score}
                onChange={handleScore}
                min={0}
                max={100}
                step={1}
                disabled={readOnly || busy}
              />
            </div>
            <div className="rules-points__slider">
              <Slider
                value={scoreValid ? draft.score : 0}
                onChange={handleScore}
                min={0}
                max={100}
                step={1}
                disabled={readOnly || busy}
              />
            </div>
          </div>
          {diff.errors.score && (
            <span className="rules-param__error" role="alert">
              {diff.errors.score}
            </span>
          )}
        </div>

        {keys.length > 0 && (
          <div className="rules-card__section">
            <div className="rules-card__section-head">
              <span className="rules-card__section-title">Parameters</span>
            </div>
            <div className="rules-params">
              {keys.map((key) => (
                <ParamField
                  key={key}
                  rule={rule}
                  name={key}
                  type={paramType(rule, key)}
                  value={draft.params[key]}
                  error={diff.errors[key]}
                  disabled={readOnly || busy}
                  onChange={(v) => updateParam(key, v)}
                />
              ))}
            </div>
          </div>
        )}

        {rule.updated_at && (
          <p className="rules-card__updated">
            Last changed{' '}
            <Tooltip content={formatDateTime(rule.updated_at)}>
              <span tabIndex={0}>{relativeTime(rule.updated_at)}</span>
            </Tooltip>
            {rule.updated_by ? ` by ${rule.updated_by}` : ''}
          </p>
        )}
      </div>

      {serverError && (
        <div className="rules-card__error">
          <Banner tone="error" icon={AlertTriangle}>
            {serverError}
          </Banner>
        </div>
      )}

      <div className="rules-card__footer">
        {readOnly ? (
          <span className="rules-card__readonly">
            <Lock size={14} aria-hidden="true" />
            Read-only access — ask an admin to change rules
          </span>
        ) : (
          <>
            <div className="rules-card__actions">
              <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setConfirmReset(true)} disabled={busy}>
                Reset to defaults
              </Button>
              {rule.custom && onDelete && (
                <Button variant="ghost" size="sm" icon={Trash2} onClick={() => onDelete(rule)} disabled={busy}>
                  Delete
                </Button>
              )}
            </div>
            <div className="rules-card__actions">
              {diff.dirty && (
                <>
                  <Button variant="ghost" size="sm" icon={Undo2} onClick={discard} disabled={busy}>
                    Discard
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={FlaskConical}
                    onClick={handleTest}
                    loading={testing}
                    disabled={diff.hasErrors || saving || resetting}
                  >
                    Test changes
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={Save}
                    onClick={handleSave}
                    loading={saving}
                    disabled={diff.hasErrors || testing || resetting}
                  >
                    Save
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {backtest && <BacktestPanel result={backtest} onClose={() => setBacktest(null)} />}

      {isAdmin && (
        <ConfirmModal
          open={confirmReset}
          onClose={() => !resetting && setConfirmReset(false)}
          onConfirm={handleReset}
          title={`Reset ${meta.displayName}?`}
          message={`Points go back to ${formatNumber(rule.default_score)} and all parameters return to their defaults. New transactions are scored with the defaults right away.`}
          confirmLabel="Reset to defaults"
          variant="danger"
          loading={resetting}
        />
      )}
    </Card>
  );
}
