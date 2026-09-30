import '../../styles/ui-display.css';

/**
 * KeyValueList({ items = [{ label, value, mono, full, align, hint }], columns = 2 })
 * <dl> grid; label text-xs text-2, value text-base; mono values are nowrap; empty values show "—".
 */
export function KeyValueList({ items = [], columns = 2, className = '' }) {
  const list = (items || []).filter(Boolean);
  return (
    <dl
      className={`kv-list${className ? ` ${className}` : ''}`}
      style={{ gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))` }}
    >
      {list.map((item, i) => {
        const empty = item.value == null || item.value === '';
        return (
          <div
            key={item.key || (typeof item.label === 'string' ? item.label : i)}
            className={`kv-list__item${item.full ? ' kv-list__item--full' : ''}`}
          >
            <dt className="kv-list__label">{item.label}</dt>
            <dd
              className={`kv-list__value${item.mono ? ' mono nowrap' : ''}${item.align === 'right' ? ' tabular-nums' : ''}${empty ? ' kv-list__value--empty' : ''}`}
              title={item.hint}
            >
              {empty ? '—' : item.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export default KeyValueList;
