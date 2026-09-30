import { Fragment } from 'react';
import { Modal, Kbd } from './ui';
import { shortcutKeys } from '../hooks/useHotkeys.js';
import '../styles/pages/layout.css';

export const GLOBAL_SHORTCUTS = [
  { combo: 'mod+k', label: 'Open command palette' },
  { combo: '/', label: 'Focus search (or open the palette)' },
  { combo: '?', label: 'Show keyboard shortcuts' },
  { combo: 'g d', label: 'Go to Dashboard' },
  { combo: 'g f', label: 'Go to Flag queue' },
  { combo: 'g t', label: 'Go to Transactions' },
  { combo: 'g n', label: 'Go to Network' },
];

export const FLAG_DETAIL_SHORTCUTS = [
  { combo: 'r', label: 'Mark reviewed' },
  { combo: 'c', label: 'Clear flag' },
  { combo: 'f', label: 'Confirm fraud (opens confirmation)' },
  { combo: 'j', label: 'Next flag' },
  { combo: 'k', label: 'Previous flag' },
  { combo: 'escape', label: 'Back to queue' },
];

function Keys({ combo }) {
  const keys = shortcutKeys(combo);
  return (
    <span className="kbd-help-keys">
      {keys.map((k, i) =>
        k === 'then' ? (
          <span key={i} className="kbd-help-then">
            then
          </span>
        ) : (
          <Fragment key={i}>
            <Kbd>{k}</Kbd>
          </Fragment>
        )
      )}
    </span>
  );
}

function Section({ title, items }) {
  return (
    <section className="kbd-help-section" aria-label={title}>
      <h3 className="kbd-help-title">{title}</h3>
      <dl className="kbd-help-list">
        {items.map((s) => (
          <div className="kbd-help-row" key={s.combo}>
            <dt className="kbd-help-label">{s.label}</dt>
            <dd className="kbd-help-combo">
              <Keys combo={s.combo} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function KeyboardShortcutsHelp({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="md">
      <div className="kbd-help">
        <Section title="Global" items={GLOBAL_SHORTCUTS} />
        <Section title="Flag detail" items={FLAG_DETAIL_SHORTCUTS} />
        <p className="kbd-help-note">Shortcuts are ignored while you are typing in a field.</p>
      </div>
    </Modal>
  );
}
