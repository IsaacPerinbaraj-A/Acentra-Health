/**
 * RiskLens logo: shield with a magnifier inside (plan 15.2 identity).
 * <Logo size={28} />                       brand shield, white glyph
 * <Logo variant="inverse" />               white shield, brand glyph (for the login hero)
 * <Logo withWordmark />                    adds the "RiskLens" wordmark
 */
export function Logo({ size = 28, variant = 'brand', withWordmark = false, className = '', title = 'RiskLens' }) {
  const inverse = variant === 'inverse';
  const shield = inverse ? 'var(--login-hero-text)' : 'var(--brand)';
  const glyph = inverse ? 'var(--brand)' : 'var(--logo-glyph)';

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={withWordmark ? undefined : 'img'}
      aria-hidden={withWordmark ? 'true' : undefined}
      aria-label={withWordmark ? undefined : title}
      focusable="false"
      className="logo-mark"
    >
      <path
        d="M16 2.5 26.5 6.2v8.6c0 6.6-4.4 12.1-10.5 14.7C9.9 26.9 5.5 21.4 5.5 14.8V6.2L16 2.5Z"
        style={{ fill: shield }}
      />
      <circle cx="15" cy="14.5" r="5" strokeWidth="2.4" style={{ stroke: glyph }} />
      <path d="m18.7 18.2 3.3 3.3" strokeWidth="2.4" strokeLinecap="round" style={{ stroke: glyph }} />
      <circle cx="15" cy="14.5" r="1.6" style={{ fill: glyph }} />
    </svg>
  );

  if (!withWordmark) {
    return <span className={`logo ${className}`.trim()}>{mark}</span>;
  }

  return (
    <span className={`logo logo--with-wordmark ${inverse ? 'logo--inverse' : ''} ${className}`.trim()}>
      {mark}
      <span className="logo-wordmark">{title}</span>
    </span>
  );
}

export default Logo;
