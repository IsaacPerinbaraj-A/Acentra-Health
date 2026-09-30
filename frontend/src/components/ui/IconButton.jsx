import { forwardRef } from 'react';
import { Tooltip } from './Tooltip.jsx';
import { Spinner } from './Spinner.jsx';
import '../../styles/ui-display.css';

/**
 * IconButton({ icon, label, onClick, size = 'md', variant = 'ghost', disabled, active,
 *              tooltip = true, tooltipPlacement = 'top', badge, loading, as, iconSize, className, ...rest })
 * label is REQUIRED: it becomes the aria-label and the tooltip text.
 * variant: ghost | secondary | primary | danger;  size: xs (24) | sm (32) | md (36)
 */
export const IconButton = forwardRef(function IconButton(
  {
    icon: Icon,
    label,
    variant = 'ghost',
    size = 'md',
    tooltip = true,
    tooltipPlacement = 'top',
    active = false,
    badge,
    loading = false,
    disabled = false,
    as,
    iconSize,
    type = 'button',
    className = '',
    ...rest
  },
  ref
) {
  const Comp = as || 'button';
  const px = iconSize || (size === 'xs' ? 14 : size === 'lg' ? 20 : 16);
  const isDisabled = disabled || loading;
  const classes = ['icon-btn', `icon-btn--${variant}`, `icon-btn--${size}`, active ? 'is-active' : '', className]
    .filter(Boolean)
    .join(' ');
  const elementProps =
    Comp === 'button'
      ? { type, disabled: isDisabled }
      : { 'aria-disabled': isDisabled || undefined, tabIndex: isDisabled ? -1 : undefined };

  const btn = (
    <Comp
      ref={ref}
      className={classes}
      aria-label={label}
      aria-pressed={active ? true : undefined}
      aria-busy={loading || undefined}
      {...rest}
      {...elementProps}
    >
      {loading ? <Spinner size={px} label={label} /> : Icon ? <Icon size={px} strokeWidth={1.75} aria-hidden="true" /> : null}
      {badge != null && badge !== 0 && badge !== false && (
        <span className="icon-btn__badge" aria-hidden="true">
          {typeof badge === 'number' && badge > 99 ? '99+' : badge}
        </span>
      )}
    </Comp>
  );

  if (!tooltip || !label) return btn;
  return (
    <Tooltip content={label} placement={tooltipPlacement} disabled={isDisabled}>
      {btn}
    </Tooltip>
  );
});

export default IconButton;
