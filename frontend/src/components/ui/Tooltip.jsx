import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../../styles/ui-display.css';

/**
 * Tooltip({ content, children, placement = 'top', delay = 300, disabled, block, className, style, maxWidth = 280 })
 * Dark tooltip (--tooltip-bg, 12 px) shown after `delay` ms on hover or keyboard focus; Esc hides.
 * Children are wrapped in an inline-flex <span> (`block` makes it flex). Rendered in a portal with
 * fixed positioning so table/card overflow never clips it; flips when there is no room.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 300,
  disabled = false,
  block = false,
  className = '',
  style,
  maxWidth = 280,
}) {
  const id = useId();
  const triggerRef = useRef(null);
  const tipRef = useRef(null);
  const timer = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const empty = content == null || content === '' || content === false;

  const show = useCallback(() => {
    if (disabled || empty) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [disabled, empty, delay]);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const contentKey = typeof content === 'string' || typeof content === 'number' ? content : null;

  useLayoutEffect(() => {
    if (!open) return;
    const t = triggerRef.current;
    const tip = tipRef.current;
    if (!t || !tip) return;
    const r = t.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let place = placement;
    if (place === 'top' && r.top - tr.height - gap < 4) place = 'bottom';
    else if (place === 'bottom' && r.bottom + tr.height + gap > vh - 4) place = 'top';
    else if (place === 'left' && r.left - tr.width - gap < 4) place = 'right';
    else if (place === 'right' && r.right + tr.width + gap > vw - 4) place = 'left';
    let top;
    let left;
    if (place === 'top' || place === 'bottom') {
      top = place === 'top' ? r.top - tr.height - gap : r.bottom + gap;
      left = r.left + r.width / 2 - tr.width / 2;
    } else {
      top = r.top + r.height / 2 - tr.height / 2;
      left = place === 'left' ? r.left - tr.width - gap : r.right + gap;
    }
    left = Math.max(4, Math.min(left, vw - tr.width - 4));
    top = Math.max(4, Math.min(top, vh - tr.height - 4));
    setPos({ top, left, place });
  }, [open, placement, contentKey]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open, hide]);

  useEffect(() => {
    if (disabled || empty) hide();
  }, [disabled, empty, hide]);

  return (
    <>
      <span
        ref={triggerRef}
        className={`tooltip-trigger${block ? ' tooltip-trigger--block' : ''}${className ? ` ${className}` : ''}`}
        style={style}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={`tooltip tooltip--${pos ? pos.place : placement}`}
            style={{
              top: pos ? pos.top : -9999,
              left: pos ? pos.left : -9999,
              maxWidth,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}

export default Tooltip;
