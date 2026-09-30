import { ChevronLeft, ChevronRight } from 'lucide-react';
import '../styles/ui-interactive.css';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

/** Page list with ellipses, e.g. [1, '…', 4, 5, 6, '…', 20]. */
function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) out.push('gap-start');
  for (let p = start; p <= end; p += 1) out.push(p);
  if (end < pages - 1) out.push('gap-end');
  out.push(pages);
  return out;
}

/**
 * Pagination({ page (1-based), pageSize, total, onPageChange(page), className })
 * Shows "1–25 of 132", prev/next and page numbers.
 */
export default function Pagination({ page = 1, pageSize = 25, total = 0, onPageChange, className = '' }) {
  const size = Math.max(1, Number(pageSize) || 25);
  const count = Math.max(0, Number(total) || 0);
  const pages = Math.max(1, Math.ceil(count / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const from = count === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(count, current * size);

  const go = (p) => {
    if (p >= 1 && p <= pages && p !== current) onPageChange?.(p);
  };

  return (
    <nav className={`ui-pager ${className}`.trim()} aria-label="Pagination">
      <div className="ui-pager__range" aria-live="polite">
        {count === 0 ? (
          'No results'
        ) : (
          <>
            <strong>
              {fmt(from)}–{fmt(to)}
            </strong>{' '}
            of <strong>{fmt(count)}</strong>
          </>
        )}
      </div>
      {pages > 1 && (
        <ul className="ui-pager__pages">
          <li>
            <button
              type="button"
              className="ui-pager__btn"
              onClick={() => go(current - 1)}
              disabled={current <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </li>
          {pageList(current, pages).map((p) =>
            typeof p === 'number' ? (
              <li key={p}>
                <button
                  type="button"
                  className="ui-pager__btn"
                  aria-current={p === current ? 'page' : undefined}
                  aria-label={`Page ${p}`}
                  onClick={() => go(p)}
                >
                  {p}
                </button>
              </li>
            ) : (
              <li key={p} className="ui-pager__gap" aria-hidden="true">
                …
              </li>
            )
          )}
          <li>
            <button
              type="button"
              className="ui-pager__btn"
              onClick={() => go(current + 1)}
              disabled={current >= pages}
              aria-label="Next page"
            >
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </li>
        </ul>
      )}
    </nav>
  );
}
