/**
 * Review statuses (plan Section 15.2.1) and notification statuses.
 * Badges always show an icon + label; CONFIRMED_FRAUD is the only solid-filled badge.
 */
import {
  AlertOctagon,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  RotateCcw,
  Send,
  ShieldX,
  XCircle,
} from 'lucide-react';

export const STATUSES = ['PENDING_REVIEW', 'REVIEWED', 'CLEARED', 'CONFIRMED_FRAUD'];
export const DECIDED_STATUSES = ['REVIEWED', 'CLEARED', 'CONFIRMED_FRAUD'];

function meta(value, label, slug, icon, hex, extra = {}) {
  return {
    value,
    label,
    icon,
    cssVar: `--status-${slug}`,
    softVar: `--status-${slug}-soft`,
    onSoftVar: `--status-${slug}-on-soft`,
    color: `var(--status-${slug})`,
    soft: `var(--status-${slug}-soft)`,
    onSoft: `var(--status-${slug}-on-soft)`,
    hex,
    solid: false,
    ...extra,
  };
}

export const STATUS_META = {
  PENDING_REVIEW: meta('PENDING_REVIEW', 'Needs review', 'pending-review', Clock, '#2563EB', {
    actionLabel: 'Reopened',
    verb: 'Reopen',
  }),
  REVIEWED: meta('REVIEWED', 'Reviewed', 'reviewed', Eye, '#7C3AED', {
    actionLabel: 'Marked reviewed',
    verb: 'Mark reviewed',
  }),
  CLEARED: meta('CLEARED', 'Cleared', 'cleared', CheckCircle2, '#059669', {
    actionLabel: 'Cleared',
    verb: 'Clear',
  }),
  CONFIRMED_FRAUD: meta('CONFIRMED_FRAUD', 'Confirmed fraud', 'confirmed-fraud', ShieldX, '#991B1B', {
    solid: true,
    actionLabel: 'Confirmed fraud',
    verb: 'Confirm fraud',
  }),
};

export const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }));

export function getStatusMeta(status) {
  return (
    STATUS_META[String(status || '').toUpperCase()] || {
      ...STATUS_META.PENDING_REVIEW,
      value: status,
      label: status ? String(status) : '—',
      icon: AlertOctagon,
    }
  );
}

export function statusLabel(status) {
  return getStatusMeta(status).label;
}

/** Icon used in timelines for "reopen" actions. */
export const REOPEN_ICON = RotateCcw;

/* ---------- Notification (alert) statuses: SENT / LOGGED / FAILED ---------- */

export const NOTIFICATION_STATUS_META = {
  SENT: { value: 'SENT', label: 'Sent', icon: Send, tone: 'success', color: 'var(--success)' },
  LOGGED: { value: 'LOGGED', label: 'Logged', icon: FileText, tone: 'neutral', color: 'var(--level-low)' },
  FAILED: { value: 'FAILED', label: 'Failed', icon: XCircle, tone: 'error', color: 'var(--error)' },
};

export const NOTIFICATION_STATUS_OPTIONS = Object.values(NOTIFICATION_STATUS_META).map((m) => ({
  value: m.value,
  label: m.label,
}));

export function getNotificationStatusMeta(status) {
  return (
    NOTIFICATION_STATUS_META[String(status || '').toUpperCase()] || {
      value: status,
      label: status ? String(status) : '—',
      icon: FileText,
      tone: 'neutral',
      color: 'var(--level-low)',
    }
  );
}
