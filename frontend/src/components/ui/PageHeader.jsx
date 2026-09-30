import '../../styles/ui-display.css';

/** PageHeader({ title, description, actions, children, eyebrow }) — h1 text-xl, description text-2, actions right. */
export function PageHeader({ title, description, actions, children, eyebrow, className = '' }) {
  return (
    <header className={`page-header${className ? ` ${className}` : ''}`}>
      <div className="page-header__row">
        <div className="page-header__titles">
          {eyebrow && <div className="page-header__eyebrow">{eyebrow}</div>}
          <h1 className="page-header__title">{title}</h1>
          {description && <p className="page-header__desc">{description}</p>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
      {children && <div className="page-header__extra">{children}</div>}
    </header>
  );
}

export default PageHeader;
