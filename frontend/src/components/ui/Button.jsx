import { forwardRef } from 'react';
import { Spinner } from './Spinner.jsx';
import '../../styles/ui-display.css';

/**
 * Button({ variant = 'secondary', size = 'md', icon, iconRight, loading, disabled, fullWidth,
 *          shortcut, as, type = 'button', onClick, className, children, ...rest })
 * variant: primary | secondary | ghost | danger | success;  size: sm (32 px) | md (36 px) | lg (44 px)
 * as: render another element, e.g. as={Link} to="/flags".
 */
export const Button = forwardRef(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    disabled = false,
    fullWidth = false,
    shortcut,
    as,
    type = 'button',
    className = '',
    children,
    ...rest
  },
  ref
) {
  const Comp = as || 'button';
  const iconSize = size === 'lg' ? 18 : 16;
  const hasChildren = children != null && children !== false;
  const classes = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    fullWidth ? 'btn--full' : '',
    loading ? 'btn--loading' : '',
    hasChildren ? '' : 'btn--icon-only',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const isDisabled = disabled || loading;
  const elementProps =
    Comp === 'button'
      ? { type, disabled: isDisabled }
      : {
          'aria-disabled': isDisabled || undefined,
          tabIndex: isDisabled ? -1 : undefined,
          onClick: isDisabled ? (e) => e.preventDefault() : rest.onClick,
        };

  return (
    <Comp ref={ref} className={classes} aria-busy={loading || undefined} {...rest} {...elementProps}>
      {loading ? (
        <Spinner size={iconSize} label="Working" />
      ) : Icon ? (
        <Icon size={iconSize} strokeWidth={1.75} aria-hidden="true" className="btn__icon" />
      ) : null}
      {hasChildren && <span className="btn__label">{children}</span>}
      {IconRight && !loading && (
        <IconRight size={iconSize} strokeWidth={1.75} aria-hidden="true" className="btn__icon" />
      )}
      {shortcut && (
        <kbd className="btn__kbd" aria-hidden="true">
          {shortcut}
        </kbd>
      )}
    </Comp>
  );
});

export default Button;
