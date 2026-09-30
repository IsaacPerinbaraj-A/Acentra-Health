import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import '../../styles/ui-interactive.css';

const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

function focusables(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null
  );
}

let openCount = 0;

/**
 * Modal({ open, onClose, title, children, footer, size = 'md' | 'sm' | 'lg', closeOnBackdrop = true,
 *         hideClose, className, 'aria-describedby' })
 * Portal to document.body; focus trap; Esc and backdrop click close; focus returns to the opener.
 * Put data-autofocus on the element that should receive focus first.
 * Key events inside the dialog do not reach global page shortcuts.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  hideClose = false,
  className = '',
  'aria-describedby': describedBy,
}) {
  const dialogRef = useRef(null);
  const downOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  // Focus management + body scroll lock
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    openCount += 1;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const raf = requestAnimationFrame(() => {
      const root = dialogRef.current;
      if (!root) return;
      const preferred = root.querySelector('[data-autofocus]');
      const list = focusables(root).filter((el) => !el.classList.contains('ui-modal__close'));
      (preferred || list[0] || root).focus();
    });

    // Esc closes even when focus drifted outside the dialog.
    const onDocKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (dialogRef.current && dialogRef.current.contains(e.target)) return; // handled by the dialog
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current?.();
    };
    window.addEventListener('keydown', onDocKey, true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onDocKey, true);
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) document.body.style.overflow = prevOverflow;
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (e.defaultPrevented) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onClose?.();
      return;
    }
    if (e.key === 'Tab') {
      const list = focusables(dialogRef.current);
      if (!list.length) {
        e.preventDefault();
        dialogRef.current?.focus();
      } else {
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    // Keep typing / single-key shortcuts from reaching page-level hotkeys.
    e.stopPropagation();
  };

  return createPortal(
    <div
      className="ui-modal-backdrop"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (closeOnBackdrop && downOnBackdrop.current && e.target === e.currentTarget) onClose?.();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={dialogRef}
        className={`ui-modal ui-modal--${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {(title || !hideClose) && (
          <div className="ui-modal__header">
            {title ? (
              <h2 id={titleId} className="ui-modal__title">
                {title}
              </h2>
            ) : (
              <span />
            )}
            {!hideClose && (
              <button type="button" className="ui-modal__close" aria-label="Close dialog" onClick={() => onClose?.()}>
                <X size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        <div className="ui-modal__body">{children}</div>
        {footer && <div className="ui-modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export default Modal;
