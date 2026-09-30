import '../../styles/ui-display.css';

function toCss(v) {
  return typeof v === 'number' ? `${v}px` : v;
}

/** Skeleton({ width = '100%', height = 16, radius, circle, className, style }) — shimmering placeholder block. */
export function Skeleton({ width = '100%', height = 16, radius, circle = false, className = '', style }) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton${className ? ` ${className}` : ''}`}
      style={{
        width: toCss(width),
        height: toCss(height),
        borderRadius: circle ? 'var(--radius-full)' : radius != null ? toCss(radius) : undefined,
        ...style,
      }}
    />
  );
}

/** SkeletonText({ lines = 3 }) — paragraph placeholder; the last line is shorter. */
export function SkeletonText({ lines = 3, lineHeight = 12, gap = 10, className = '' }) {
  return (
    <div className={`skeleton-text${className ? ` ${className}` : ''}`} style={{ gap }} aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={lineHeight} width={i === lines - 1 && lines > 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

const ROW_WIDTHS = ['70%', '55%', '85%', '45%', '65%', '75%', '50%'];

/** SkeletonRows({ rows = 5, columns = 5 }) — table-like placeholder rows. */
export function SkeletonRows({ rows = 5, columns = 5, rowHeight = 48, className = '' }) {
  return (
    <div className={`skeleton-rows${className ? ` ${className}` : ''}`} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="skeleton-rows__row"
          style={{ height: rowHeight, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} height={12} width={ROW_WIDTHS[(r + c) % ROW_WIDTHS.length]} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
