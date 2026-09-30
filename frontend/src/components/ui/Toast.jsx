import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import '../../styles/ui-interactive.css';

const MAX_TOASTS = 3;
const EXIT_MS = 200;
const ICONS = { success: CircleCheck, error: CircleAlert, info: Info };

const noop = () => null;
noop.dismiss = () => {};
noop.success = noop;
noop.error = noop;
noop.info = noop;

const ToastContext = createContext(null);

let seq = 0;

function ToastItem({ toast, onDismiss }) {
  const { id, variant, title, message, action, duration, leaving } = toast;
  const remaining = useRef(duration);
  const startedAt = useRef(0);
  const timer = useRef(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const start = useCallback(() => {
    clear();
    if (!duration || duration === Infinity || leaving) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => onDismiss(id), Math.max(0, remaining.current));
  }, [duration, id, leaving, onDismiss]);
  const pause = () => {
    if (!timer.current) return;
    clear();
    remaining.current -= Date.now() - startedAt.current;
  };

  useEffect(() => {
    start();
    return clear;
  }, [start]);

  const Icon = ICONS[variant] || Info;
  return (
    <div
      className={`ui-toast ui-toast--${variant}${leaving ? ' ui-toast--leaving' : ''}`}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={pause}
      onMouseLeave={start}
      onFocus={pause}
      onBlur={start}
    >
      <Icon size={18} strokeWidth={1.75} className="ui-toast__icon" aria-hidden="true" />
      <div className="ui-toast__body">
        {title && <div className="ui-toast__title">{title}</div>}
        {message && <div className="ui-toast__msg">{message}</div>}
      </div>
      {action?.label && (
        <button
          type="button"
          className="ui-toast__action"
          onClick={() => {
            try {
              action.onClick?.();
            } finally {
              onDismiss(id);
            }
          }}
        >
          {action.label}
        </button>
      )}
      <button type="button" className="ui-toast__close" aria-label="Dismiss notification" onClick={() => onDismiss(id)}>
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

/** ToastProvider — wrap the app once; renders the bottom-right stack (max 3). */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const exitTimers = useRef(new Map());

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    exitTimers.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id) => {
      if (id === undefined) {
        setToasts((list) => list.map((t) => ({ ...t, leaving: true })));
        setTimeout(() => setToasts([]), EXIT_MS);
        return;
      }
      if (exitTimers.current.has(id)) return;
      setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      exitTimers.current.set(
        id,
        setTimeout(() => remove(id), EXIT_MS)
      );
    },
    [remove]
  );

  useEffect(() => {
    const timers = exitTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const toast = useCallback((opts = {}) => {
    const input = typeof opts === 'string' ? { title: opts } : opts;
    const id = input.id ?? `t${++seq}`;
    const item = {
      id,
      variant: ['success', 'error', 'info'].includes(input.variant) ? input.variant : 'info',
      title: input.title,
      message: input.message,
      action: input.action,
      duration: input.duration ?? 4000,
      leaving: false,
    };
    setToasts((list) => {
      const rest = list.filter((t) => t.id !== id && !t.leaving);
      return [...rest, item].slice(-MAX_TOASTS);
    });
    return id;
  }, []);

  const api = useMemo(() => {
    const fn = (opts) => toast(opts);
    fn.dismiss = dismiss;
    fn.success = (title, message, extra) => toast({ ...extra, variant: 'success', title, message });
    fn.error = (title, message, extra) => toast({ ...extra, variant: 'error', title, message });
    fn.info = (title, message, extra) => toast({ ...extra, variant: 'info', title, message });
    return fn;
  }, [toast, dismiss]);

  const stack =
    typeof document !== 'undefined'
      ? createPortal(
          <div className="ui-toasts" role="region" aria-label="Notifications">
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {stack}
    </ToastContext.Provider>
  );
}

/**
 * useToast() → toast({ variant: 'success'|'error'|'info', title, message, action: {label, onClick}, duration = 4000 })
 * Returns the toast id. Also toast.dismiss(id?), toast.success(title, message), toast.error(...), toast.info(...).
 */
export function useToast() {
  return useContext(ToastContext) || noop;
}

export default ToastProvider;
