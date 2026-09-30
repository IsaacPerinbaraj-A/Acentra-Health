import { useEffect, useId, useState } from 'react';
import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { Modal } from './Modal.jsx';
import { Input } from './Input.jsx';
import * as ButtonMod from './Button.jsx';
import '../../styles/ui-interactive.css';

const Button = ButtonMod.Button || ButtonMod.default;

const ICONS = { danger: TriangleAlert, success: CircleCheck, primary: Info, secondary: Info };

/**
 * ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
 *                variant = 'danger', requireText, loading, children })
 * requireText (e.g. "RESET") gates the confirm button until typed exactly.
 */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  requireText,
  loading = false,
  children,
}) {
  const [typed, setTyped] = useState('');
  const msgId = useId();

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const matches = !requireText || typed.trim() === String(requireText);
  const canConfirm = matches && !loading;
  const Icon = ICONS[variant] || Info;

  const confirm = () => {
    if (canConfirm) onConfirm?.();
  };

  const close = () => {
    if (!loading) onClose?.();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="sm"
      aria-describedby={message ? msgId : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={loading} data-autofocus={requireText ? undefined : ''}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={confirm} disabled={!matches} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="ui-confirm">
        <span className={`ui-confirm__icon ui-confirm__icon--${variant}`} aria-hidden="true">
          <Icon size={20} strokeWidth={1.75} />
        </span>
        <div className="ui-confirm__content">
          {message && <div id={msgId}>{message}</div>}
          {children}
          {requireText && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                confirm();
              }}
            >
              <Input
                label={
                  <>
                    Type <span className="ui-confirm__code">{requireText}</span> to confirm
                  </>
                }
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={loading}
                data-autofocus=""
                mono
              />
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default ConfirmModal;
