import { Fragment, useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, Inbox, Rows3, Rows4, TriangleAlert } from 'lucide-react';
import * as EmptyMod from './EmptyState.jsx';
import * as ErrorMod from './ErrorState.jsx';
import * as ButtonMod from './Button.jsx';
import useLocalStorage from '../../hooks/useLocalStorage.js';
import { normalizeLevel } from '../../constants/levels.js';
import '../../styles/ui-interactive.css';

const EmptyState = EmptyMod.EmptyState || EmptyMod.default;
const ErrorState = ErrorMod.ErrorState || ErrorMod.default;
const Button = ButtonMod.Button || ButtonMod.default;

const DENSITY_KEY = 'risklens.tableDensity';
const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="switch"],[data-no-row-click]';

/** Shared table density ('comfortable' | 'compact'), remembered in localStorage. */
export function useTableDensity() {
  const [density, setDensity] = useLocalStorage(DENSITY_KEY, 'comfortable');
  const toggle = useCallback(
    () => setDensity(density === 'compact' ? 'comfortable' : 'compact'),
    [density, setDensity]
  );
  return { density, compact: density === 'compact', setDensity, toggle };
}

function getKey(row, rowKey, index) {
  if (typeof rowKey === 'function') return rowKey(row, index);
  const k = row?.[rowKey];
  return k === undefined || k === null ? index : k;
}

function errorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return error.detail || error.message || 'Something went wrong';
}

/**
 * DataTable — see components/ui/README.md for the props contract.
 * Extra optional props: densityToggle (default true when `compact` is not controlled),
 * skeletonRows (default 6), caption (sr-only), className.
 */
export function DataTable({
  columns = [],
  rows,
  rowKey = 'id',
  onRowClick,
  getRowLevel,
  loading = false,
  error,
  onRetry,
  empty,
  sort,
  onSortChange,
  renderExpanded,
  compact,
  densityToggle = true,
  skeletonRows = 6,
  caption,
  className = '',
}) {
  const { compact: storedCompact, toggle: toggleDensity } = useTableDensity();
  const isCompact = compact === undefined ? storedCompact : !!compact;
  const showDensity = compact === undefined && densityToggle;
  const [expanded, setExpanded] = useState(() => new Set());

  const list = Array.isArray(rows) ? rows : [];
  const hasRows = list.length > 0;
  const expandable = typeof renderExpanded === 'function';
  const totalCols = columns.length + (expandable ? 1 : 0) + (showDensity ? 1 : 0);

  const toggleExpanded = useCallback((key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleSort = (col) => {
    if (!onSortChange) return;
    if (sort?.key === col.key) {
      onSortChange({ key: col.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ key: col.key, dir: col.align === 'right' ? 'desc' : 'asc' });
    }
  };

  const onRowActivate = (e, row) => {
    if (!onRowClick) return;
    const hit = e.target.closest?.(INTERACTIVE);
    if (hit && hit !== e.currentTarget && e.currentTarget.contains(hit)) return;
    onRowClick(row, e);
  };

  const onRowKeyDown = (e, row, key) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      if (onRowClick) {
        e.preventDefault();
        onRowClick(row, e);
      } else if (expandable) {
        e.preventDefault();
        toggleExpanded(key);
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const tbody = e.currentTarget.parentElement;
      const focusables = Array.from(tbody?.querySelectorAll('tr[data-dt-row]') || []);
      const idx = focusables.indexOf(e.currentTarget);
      const next = focusables[idx + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    } else if (expandable && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const isOpen = expanded.has(key);
      if ((e.key === 'ArrowRight') !== isOpen) {
        e.preventDefault();
        toggleExpanded(key);
      }
    }
  };

  const renderHeader = (col) => {
    const align = col.align || 'left';
    const active = sort?.key === col.key;
    const ariaSort = col.sortable ? (active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;
    const SortIcon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <th
        key={col.key}
        scope="col"
        aria-sort={ariaSort}
        className={`ui-dt__th ui-dt__th--${align}`}
        style={col.width ? { width: col.width } : undefined}
      >
        {col.sortable && onSortChange ? (
          <button
            type="button"
            className={`ui-dt__sort${active ? ' ui-dt__sort--active' : ''}`}
            onClick={() => handleSort(col)}
            aria-label={`Sort by ${typeof col.header === 'string' ? col.header : col.key}`}
          >
            {align === 'right' && <SortIcon size={14} strokeWidth={1.75} className="ui-dt__sort-icon" aria-hidden="true" />}
            <span>{col.header}</span>
            {align !== 'right' && <SortIcon size={14} strokeWidth={1.75} className="ui-dt__sort-icon" aria-hidden="true" />}
          </button>
        ) : (
          col.header
        )}
      </th>
    );
  };

  const cellClass = (col) =>
    [
      'ui-dt__td',
      `ui-dt__td--${col.align || 'left'}`,
      col.mono ? 'ui-dt__td--mono' : '',
      col.nowrap ? 'ui-dt__td--nowrap' : '',
    ]
      .filter(Boolean)
      .join(' ');

  const renderCell = (col, row) => {
    if (typeof col.render === 'function') return col.render(row);
    const v = row?.[col.key];
    return v === null || v === undefined || v === '' ? '—' : v;
  };

  const stateRow = (content) => (
    <tr className="ui-dt__state">
      <td colSpan={totalCols}>{content}</td>
    </tr>
  );

  let body;
  if (error && !(loading && hasRows)) {
    body = stateRow(
      ErrorState ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : (
        <div className="ui-dt__block" role="alert">
          <span className="ui-dt__block-icon ui-dt__block-icon--error">
            <TriangleAlert size={20} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="ui-dt__block-title">Something went wrong</div>
          <div>{errorMessage(error)}</div>
          {onRetry && Button && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      )
    );
  } else if (loading && !hasRows) {
    body = Array.from({ length: skeletonRows }, (_, i) => (
      <tr key={`skel-${i}`} className="ui-dt__skel-row" aria-hidden="true">
        {expandable && <td className="ui-dt__td--expander" />}
        {columns.map((col) => (
          <td key={col.key} className={`ui-dt__td--${col.align || 'left'}`}>
            <span
              className={`ui-dt__skel${col.align === 'right' ? ' ui-dt__skel--right' : ''}`}
              style={{ width: `${45 + ((i * 17 + col.key.length * 7) % 40)}%` }}
            />
          </td>
        ))}
        {showDensity && <td />}
      </tr>
    ));
  } else if (!hasRows) {
    const e = empty || {};
    body = stateRow(
      EmptyState ? (
        <EmptyState
          icon={e.icon || Inbox}
          title={e.title || 'No results'}
          description={e.description}
          action={e.action}
          tone={e.tone}
        />
      ) : (
        <div className="ui-dt__block">
          <span className="ui-dt__block-icon">
            {(() => {
              const Icon = e.icon || Inbox;
              return <Icon size={20} strokeWidth={1.75} aria-hidden="true" />;
            })()}
          </span>
          <div className="ui-dt__block-title">{e.title || 'No results'}</div>
          {e.description && <div>{e.description}</div>}
          {e.action}
        </div>
      )
    );
  } else {
    body = list.map((row, index) => {
      const key = getKey(row, rowKey, index);
      const level = getRowLevel ? normalizeLevel(getRowLevel(row)) : null;
      const isOpen = expandable && expanded.has(key);
      const focusable = !!onRowClick || expandable;
      const cls = [
        'ui-dt__row',
        level ? 'ui-dt__row--level' : '',
        level === 'CRITICAL' ? 'ui-dt__row--critical' : '',
        onRowClick ? 'ui-dt__row--clickable' : '',
        isOpen ? 'ui-dt__row--expanded' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return (
        <Fragment key={key}>
          <tr
            className={cls}
            style={level ? { '--row-level': `var(--level-${level.toLowerCase()})` } : undefined}
            tabIndex={focusable ? 0 : undefined}
            data-dt-row={focusable ? '' : undefined}
            onClick={onRowClick ? (e) => onRowActivate(e, row) : undefined}
            onKeyDown={focusable ? (e) => onRowKeyDown(e, row, key) : undefined}
            aria-expanded={expandable ? isOpen : undefined}
          >
            {expandable && (
              <td className="ui-dt__td ui-dt__td--expander">
                <button
                  type="button"
                  className="ui-dt__expand-btn"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? 'Collapse row' : 'Expand row'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpanded(key);
                  }}
                >
                  <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </td>
            )}
            {columns.map((col) => (
              <td key={col.key} className={cellClass(col)} style={col.width ? { width: col.width } : undefined}>
                {renderCell(col, row)}
              </td>
            ))}
            {showDensity && <td className="ui-dt__td ui-dt__td--tools" />}
          </tr>
          {isOpen && (
            <tr className="ui-dt__expanded">
              <td colSpan={totalCols}>{renderExpanded(row)}</td>
            </tr>
          )}
        </Fragment>
      );
    });
  }

  const classes = [
    'ui-dt',
    isCompact ? 'ui-dt--compact' : '',
    loading && hasRows ? 'ui-dt--refreshing' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <div className="ui-dt__scroll">
        <table className="ui-dt__table" aria-busy={loading || undefined}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {expandable && (
                <th scope="col" className="ui-dt__th ui-dt__th--expander">
                  <span className="sr-only">Expand</span>
                </th>
              )}
              {columns.map(renderHeader)}
              {showDensity && (
                <th scope="col" className="ui-dt__th ui-dt__th--tools">
                  <button
                    type="button"
                    className="ui-dt__density"
                    onClick={toggleDensity}
                    aria-label={isCompact ? 'Use comfortable rows' : 'Use compact rows'}
                    title={isCompact ? 'Comfortable rows' : 'Compact rows'}
                  >
                    {isCompact ? (
                      <Rows3 size={16} strokeWidth={1.75} aria-hidden="true" />
                    ) : (
                      <Rows4 size={16} strokeWidth={1.75} aria-hidden="true" />
                    )}
                  </button>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="ui-dt__body">{body}</tbody>
        </table>
      </div>
    </div>
  );
}

export default DataTable;
