import { useEffect, useRef } from 'react';

/**
 * useHotkeys(bindings, { enabled = true, allowInModal = false })
 *
 * bindings: { [combo]: (event) => void }
 *   - single keys:  "?", "/", "j", "Escape", "Enter"
 *   - modifiers:    "mod+k" (Ctrl on Windows/Linux, Cmd on Mac), "shift+n", "alt+x"
 *   - sequences:    "g d" (press g, then d within 1 s)
 *
 * Rules:
 *   - Keys WITHOUT ctrl/cmd/alt are ignored while typing in input/textarea/select/contenteditable.
 *   - Keys WITHOUT ctrl/cmd/alt are ignored while a modal ([aria-modal="true"]) is open,
 *     unless { allowInModal: true }.
 *   - When a binding matches, preventDefault() is called.
 * The latest bindings object is always used (no need to memoise it).
 */

const SEQUENCE_TIMEOUT = 1000;

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

const KEY_ALIASES = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
};

function normKey(k) {
  const lower = String(k).toLowerCase();
  return KEY_ALIASES[lower] || lower;
}

function parseCombo(combo) {
  // "mod+k" | "shift+?" | "?" | "+" (literal plus)
  const parts = combo === '+' ? ['+'] : combo.split('+').filter(Boolean);
  const key = normKey(parts.pop() || '');
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    key,
    mod: mods.has('mod') || mods.has('ctrl') || mods.has('cmd') || mods.has('meta'),
    shift: mods.has('shift'),
    alt: mods.has('alt') || mods.has('option'),
  };
}

function parseBinding(binding) {
  const trimmed = binding.trim();
  if (trimmed !== ' ' && /\s/.test(trimmed)) {
    return { sequence: trimmed.split(/\s+/).map(parseCombo) };
  }
  return { sequence: [parseCombo(trimmed)] };
}

function matches(step, e) {
  const key = normKey(e.key);
  const hasMod = e.ctrlKey || e.metaKey;
  if (step.mod !== hasMod) return false;
  if (step.alt !== e.altKey) return false;
  // For printable single characters shift is part of the character ("?" = shift+/)
  const printable = key.length === 1;
  if (!printable && step.shift !== e.shiftKey) return false;
  if (printable && step.shift && !e.shiftKey) return false;
  return step.key === key;
}

export function isTypingTarget(el) {
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return false;
}

function modalOpen() {
  return typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"]');
}

export default function useHotkeys(bindings, options = {}) {
  const { enabled = true, allowInModal = false } = options;
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const allowRef = useRef(allowInModal);
  allowRef.current = allowInModal;

  useEffect(() => {
    if (!enabled) return undefined;
    let buffer = [];
    let lastTime = 0;

    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      const hasMod = e.ctrlKey || e.metaKey || e.altKey;
      if (!hasMod) {
        if (isTypingTarget(e.target)) return;
        if (!allowRef.current && modalOpen()) return;
      }

      const now = Date.now();
      if (now - lastTime > SEQUENCE_TIMEOUT) buffer = [];
      lastTime = now;
      buffer.push(e);
      if (buffer.length > 4) buffer = buffer.slice(-4);

      const entries = Object.entries(bindingsRef.current || {});
      // 1) sequences (longest first)
      const parsed = entries
        .filter(([, fn]) => typeof fn === 'function')
        .map(([combo, fn]) => ({ combo, fn, ...parseBinding(combo) }))
        .sort((a, b) => b.sequence.length - a.sequence.length);

      for (const b of parsed) {
        const n = b.sequence.length;
        if (buffer.length < n) continue;
        const tail = buffer.slice(-n);
        if (b.sequence.every((step, i) => matches(step, tail[i]))) {
          e.preventDefault();
          buffer = [];
          b.fn(e);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/** "mod+k" -> ["Ctrl", "K"] (or ["⌘", "K"] on Mac); "g d" -> ["G", "then", "D"]. */
export function shortcutKeys(combo) {
  const out = [];
  const steps = combo.trim().split(/\s+/);
  steps.forEach((step, i) => {
    if (i > 0) out.push('then');
    const parts = step === '+' ? ['+'] : step.split('+');
    parts.forEach((p) => {
      const l = p.toLowerCase();
      if (l === 'mod') out.push(isMac ? '⌘' : 'Ctrl');
      else if (l === 'ctrl') out.push('Ctrl');
      else if (l === 'cmd' || l === 'meta') out.push('⌘');
      else if (l === 'shift') out.push('Shift');
      else if (l === 'alt') out.push(isMac ? '⌥' : 'Alt');
      else if (l === 'escape' || l === 'esc') out.push('Esc');
      else if (l === 'enter') out.push('Enter');
      else out.push(p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1));
    });
  });
  return out;
}

/** "mod+k" -> "Ctrl K" */
export function formatShortcut(combo) {
  return shortcutKeys(combo).join(' ');
}

// Named export too, so both import styles work.
export { useHotkeys };
