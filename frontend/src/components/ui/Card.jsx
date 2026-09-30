import '../../styles/ui-display.css';

/** Card({ title, subtitle, actions, icon, children, className, bodyClassName, padded = true, as = 'section', ...rest }) */
export function Card({
  title,
  subtitle,
  actions,
  icon: Icon,
  children,
  className = '',
  bodyClassName = '',
  padded = true,
  as: Comp = 'section',
  ...rest
}) {
  const hasHeader = title != null || subtitle != null || actions != null;
  return (
    <Comp className={`card${className ? ` ${className}` : ''}`} {...rest}>
      {hasHeader && (
        <header className="card__header">
          <div className="card__heading">
            {Icon && (
              <span className="card__icon" aria-hidden="true">
                <Icon size={16} strokeWidth={1.75} />
              </span>
            )}
            <div className="card__titles">
              {title != null && <h2 className="card__title">{title}</h2>}
              {subtitle != null && <p className="card__subtitle">{subtitle}</p>}
            </div>
          </div>
          {actions != null && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className={`card__body${padded ? '' : ' card__body--flush'}${bodyClassName ? ` ${bodyClassName}` : ''}`}>
        {children}
      </div>
    </Comp>
  );
}

export default Card;
