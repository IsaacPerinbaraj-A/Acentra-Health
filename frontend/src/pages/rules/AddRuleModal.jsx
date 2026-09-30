import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Input, Modal, NumberInput, Select, Textarea } from '../../components/ui';
import { apiFetch } from '../../api/client';

const FALLBACK_OPTIONS = {
  fields: [
    { value: 'amount', label: 'Amount', type: 'number' },
    { value: 'account_balance', label: 'Account balance', type: 'number' },
    { value: 'merchant', label: 'Merchant', type: 'text' },
    { value: 'city', label: 'City', type: 'text' },
    { value: 'device_id', label: 'Device id', type: 'text' },
    { value: 'customer_id', label: 'Customer id', type: 'text' },
    { value: 'currency', label: 'Currency', type: 'text' },
  ],
  numeric_operators: [
    { value: 'gte', label: '≥' }, { value: 'gt', label: '>' }, { value: 'lte', label: '≤' },
    { value: 'lt', label: '<' }, { value: 'eq', label: '=' }, { value: 'neq', label: '≠' },
  ],
  text_operators: [
    { value: 'eq', label: 'equals' }, { value: 'neq', label: 'does not equal' },
    { value: 'contains', label: 'contains' }, { value: 'in', label: 'is one of (comma-separated)' },
  ],
};

const EMPTY = { display_name: '', name: '', description: '', score: 20, field: 'amount', operator: 'gte', value: '100000' };

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'r_$1').slice(0, 41);

/** Modal to create a condition rule; the backend writes app/rules/custom_<id>.py and hot-reloads. */
export default function AddRuleModal({ open, onClose, onCreated, toast }) {
  const [form, setForm] = useState(EMPTY);
  const [idTouched, setIdTouched] = useState(false);
  const [options, setOptions] = useState(FALLBACK_OPTIONS);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setIdTouched(false);
    setError('');
    apiFetch('/api/rules/builder/options').then(setOptions).catch(() => {});
  }, [open]);

  const field = options.fields.find((f) => f.value === form.field) || options.fields[0];
  const isNumber = field?.type === 'number';
  const ops = isNumber ? options.numeric_operators : options.text_operators;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const onFieldChange = (value) => {
    const f = options.fields.find((x) => x.value === value);
    const numeric = f?.type === 'number';
    setForm((prev) => ({
      ...prev,
      field: value,
      operator: numeric ? 'gte' : 'eq',
      value: numeric ? (prev.value && !Number.isNaN(Number(prev.value)) ? prev.value : '100000') : '',
    }));
  };

  const preview = useMemo(() => {
    const opLabel = ops.find((o) => o.value === form.operator)?.label || form.operator;
    return `${field?.label || form.field} ${opLabel} ${form.value || '…'}`;
  }, [field, form.field, form.operator, form.value, ops]);

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = { ...form, value: isNumber ? Number(form.value) : form.value };
      const created = await apiFetch('/api/rules', { method: 'POST', body });
      toast?.({ variant: 'success', title: 'Rule added', message: `${created.display_name} is live and runs on new transactions.` });
      onCreated?.(created);
      onClose?.();
    } catch (err) {
      setError(err.message || 'Could not create the rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add rule"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" icon={Plus} onClick={submit} loading={saving}
            disabled={!form.display_name.trim() || !form.name || form.value === ''}>
            Add rule
          </Button>
        </>
      }
    >
      <form className="rules-add" onSubmit={submit}>
        <p className="rules-add__hint">
          Creates <code className="mono">backend/app/rules/custom_{form.name || 'rule_id'}.py</code> and loads it
          immediately — no restart. It fires when the condition matches.
        </p>
        <Input label="Display name" value={form.display_name} data-autofocus required
          onChange={(e) => { set('display_name', e.target.value); if (!idTouched) set('name', slugify(e.target.value)); }}
          placeholder="e.g. Large transfer" />
        <Input label="Rule id" mono value={form.name} hint="lowercase letters, digits and underscores"
          onChange={(e) => { setIdTouched(true); set('name', slugify(e.target.value)); }} />
        <Textarea label="Description" rows={2} value={form.description}
          onChange={(e) => set('description', e.target.value)} placeholder="One sentence for the Rules page" />
        <div className="rules-add__row">
          <Select label="Field" options={options.fields} value={form.field} onChange={onFieldChange} />
          <Select label="Operator" options={ops} value={form.operator} onChange={(v) => set('operator', v)} />
        </div>
        <Input label="Value" value={form.value} inputMode={isNumber ? 'decimal' : 'text'}
          mono={!isNumber} onChange={(e) => set('value', e.target.value)}
          placeholder={isNumber ? '100000' : form.operator === 'in' ? 'CryptoXchange, QuickGiftCards' : 'Delhi'} />
        <NumberInput label="Points when it fires" value={form.score} min={0} max={100}
          onChange={(v) => set('score', v)} />
        <div className="rules-add__preview">Fires when <strong>{preview}</strong> → +{form.score} points</div>
        {error && <div className="rules-add__error" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}
