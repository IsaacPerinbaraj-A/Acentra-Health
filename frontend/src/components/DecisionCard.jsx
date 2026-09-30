import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, Gavel, Lock, RotateCcw, ShieldX } from 'lucide-react';
import { apiFetch } from '../api/client';
import { trackActivity } from '../hooks/useApi';
import useHotkeys from '../hooks/useHotkeys';
import useLocalStorage from '../hooks/useLocalStorage';
import { useAuth } from '../auth/AuthContext';
import { getStatusMeta } from '../constants/statuses';
import { formatDateTime, relativeTime } from '../utils/format';
import { Button, Card, ConfirmModal, Switch, Textarea, Tooltip, useToast } from './ui';

export const AUTO_ADVANCE_KEY = 'risklens.flagDetail.autoAdvance';

/**
 * DecisionCard({ detail, onDecided })
 * detail: FlagDetail (API contract). onDecided(newDetail, meta) is called after every successful
 * status change. meta = { status, previousStatus, flagId, autoAdvance, undo }.
 * The page decides whether to auto-advance or refresh in place.
 */
export default function DecisionCard({ detail, onDecided }) {
  const { hasRole } = useAuth();
  const toast = useToast();
  const canAct = hasRole ? hasRole('REVIEWER', 'ADMIN') : false;

  const flag = detail?.flag || {};
  const flagId = flag.id;
  const status = flag.status;
  const txnId = detail?.transaction?.transaction_id;

  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null); // status being submitted
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [autoAdvance, setAutoAdvance] = useLocalStorage(AUTO_ADVANCE_KEY, true);

  const onDecidedRef = useRef(onDecided);
  onDecidedRef.current = onDecided;

  useEffect(() => {
    setNote('');
    setConfirmOpen(false);
    setBusy(null);
  }, [flagId]);

  const postStatus = (id, next, text) =>
    trackActivity(
      apiFetch(`/api/flags/${id}/status`, {
        method: 'POST',
        body: text ? { status: next, note: text } : { status: next },
      })
    );

  const undo = async (id, previousStatus, txn) => {
    try {
      const res = await postStatus(id, previousStatus, 'Undo');
      toast({
        variant: 'info',
        title: 'Decision undone',
        message: `${txn || `Flag ${id}`} is back to ${getStatusMeta(previousStatus).label.toLowerCase()}.`,
      });
      onDecidedRef.current?.(res, { status: previousStatus, flagId: id, undo: true, autoAdvance: false });
    } catch (err) {
      toast({ variant: 'error', title: 'Undo failed', message: err?.message || 'Please try again.' });
    }
  };

  const decide = async (next) => {
    if (!canAct || busy || !flagId || next === status) return;
    const previousStatus = status;
    const id = flagId;
    const txn = txnId;
    setBusy(next);
    try {
      const res = await postStatus(id, next, note.trim());
      setConfirmOpen(false);
      setNote('');
      const m = getStatusMeta(next);
      toast({
        variant: next === 'CONFIRMED_FRAUD' ? 'error' : next === 'PENDING_REVIEW' ? 'info' : 'success',
        title: next === 'PENDING_REVIEW' ? 'Flag reopened' : m.actionLabel || m.label,
        message: `${txn || `Flag ${id}`} marked as ${m.label.toLowerCase()}.`,
        duration: 5000,
        action: { label: 'Undo', onClick: () => undo(id, previousStatus, txn) },
      });
      onDecidedRef.current?.(res, {
        status: next,
        previousStatus,
        flagId: id,
        autoAdvance: !!autoAdvance,
        undo: false,
      });
    } catch (err) {
      toast({
        variant: 'error',
        title: 'Could not update the flag',
        message: err?.message || 'Please try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  const hotkeysOn = canAct && !busy && !confirmOpen && !!flagId;
  useHotkeys(
    {
      r: () => decide('REVIEWED'),
      c: () => decide('CLEARED'),
      f: () => {
        if (status !== 'CONFIRMED_FRAUD') setConfirmOpen(true);
      },
    },
    { enabled: hotkeysOn }
  );

  const decided = status && status !== 'PENDING_REVIEW';
  const lastAction = (detail?.review_actions || [])[0];
  const decidedBy = flag.last_reviewed_by_username || lastAction?.username || 'a reviewer';
  const decidedAt = flag.last_reviewed_at || lastAction?.created_at || flag.updated_at;
  const sm = getStatusMeta(status);
  const StatusIcon = sm.icon;

  const disabledAll = !canAct || !!busy;

  const currentTip = (s, node) =>
    s === status ? (
      <Tooltip content="This is the current status">
        <span className="decision__tip-wrap">{node}</span>
      </Tooltip>
    ) : (
      node
    );

  return (
    <Card
      title="Decision"
      icon={Gavel}
      className={`decision${canAct ? '' : ' decision--readonly'}`}
      actions={
        !canAct ? (
          <span className="decision__lock">
            <Lock size={14} strokeWidth={1.75} aria-hidden="true" />
            Read-only access
          </span>
        ) : null
      }
    >
      {decided && (
        <div className="decision__summary" style={{ '--st-color': sm.color }}>
          <StatusIcon size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="decision__summary-text">
            {sm.label} by <strong>{decidedBy}</strong>{' '}
            {decidedAt ? (
              <Tooltip content={formatDateTime(decidedAt)}>
                <span className="decision__when" tabIndex={0}>
                  {relativeTime(decidedAt)}
                </span>
              </Tooltip>
            ) : null}
          </span>
          {canAct && (
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              loading={busy === 'PENDING_REVIEW'}
              disabled={!!busy}
              onClick={() => decide('PENDING_REVIEW')}
              className="decision__reopen"
            >
              Reopen
            </Button>
          )}
        </div>
      )}

      {!canAct && (
        <p className="decision__readonly-msg">
          <Lock size={16} strokeWidth={1.75} aria-hidden="true" />
          Your role can view flags but not change their status. Ask a reviewer or admin.
        </p>
      )}

      <Textarea
        label="Review note"
        placeholder="Add context for the audit trail…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        maxLength={1000}
        disabled={disabledAll}
      />

      <div className="decision__buttons">
        {currentTip(
          'CONFIRMED_FRAUD',
          <Button
            variant="danger"
            size="lg"
            fullWidth
            icon={ShieldX}
            shortcut="F"
            loading={busy === 'CONFIRMED_FRAUD'}
            disabled={disabledAll || status === 'CONFIRMED_FRAUD'}
            onClick={() => setConfirmOpen(true)}
          >
            Confirm fraud
          </Button>
        )}
        {currentTip(
          'CLEARED',
          <Button
            variant="success"
            size="lg"
            fullWidth
            icon={CheckCircle2}
            shortcut="C"
            loading={busy === 'CLEARED'}
            disabled={disabledAll || status === 'CLEARED'}
            onClick={() => decide('CLEARED')}
          >
            Clear
          </Button>
        )}
        {currentTip(
          'REVIEWED',
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            icon={Eye}
            shortcut="R"
            className="decision__reviewed-btn"
            loading={busy === 'REVIEWED'}
            disabled={disabledAll || status === 'REVIEWED'}
            onClick={() => decide('REVIEWED')}
          >
            Mark reviewed
          </Button>
        )}
      </div>

      <div className="decision__footer">
        <Switch
          checked={!!autoAdvance}
          onChange={(v) => setAutoAdvance(!!v)}
          label="Auto-advance to next flag"
          disabled={!canAct}
        />
      </div>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => (busy ? null : setConfirmOpen(false))}
        onConfirm={() => decide('CONFIRMED_FRAUD')}
        title="Confirm fraud?"
        message={
          <>
            Transaction <span className="mono">{txnId}</span> will be marked as confirmed fraud and recorded
            in the audit trail{note.trim() ? ' with your note' : ''}. You can undo this from the toast or
            reopen the flag later.
          </>
        }
        confirmLabel="Confirm fraud"
        variant="danger"
        loading={busy === 'CONFIRMED_FRAUD'}
      />
    </Card>
  );
}
