import '../../styles/ui-display.css';

/**
 * ChartTooltip — recharts `content` renderer:
 *   <Tooltip content={<ChartTooltip formatter={(value, name, entry) => ...} labelFormatter={(label, payload) => ...} />} />
 * formatter may return a node or [value, name] like recharts. Card: surface, border, shadow-md, color swatches.
 */
export function ChartTooltip({ active, payload, label, formatter, labelFormatter, nameFormatter, hideLabel = false, footer }) {
  if (!active || !payload || payload.length === 0) return null;
  const title = hideLabel ? null : labelFormatter ? labelFormatter(label, payload) : label;
  return (
    <div className="chart-tooltip">
      {title != null && title !== '' && <div className="chart-tooltip__label">{title}</div>}
      <ul className="chart-tooltip__list">
        {payload.map((entry, i) => {
          if (!entry) return null;
          let value = entry.value;
          let name = entry.name ?? entry.dataKey;
          if (formatter) {
            const out = formatter(entry.value, name, entry, i, payload);
            if (Array.isArray(out)) {
              value = out[0];
              if (out[1] != null) name = out[1];
            } else {
              value = out;
            }
          }
          if (nameFormatter) name = nameFormatter(name, entry);
          const color = entry.color || entry.payload?.fill || entry.fill || entry.stroke || 'var(--text-3)';
          return (
            <li key={`${entry.dataKey ?? name}-${i}`} className="chart-tooltip__row">
              <span className="chart-tooltip__swatch" style={{ background: color }} aria-hidden="true" />
              <span className="chart-tooltip__name">{name}</span>
              <span className="chart-tooltip__value">{value}</span>
            </li>
          );
        })}
      </ul>
      {footer && <div className="chart-tooltip__footer">{typeof footer === 'function' ? footer(payload) : footer}</div>}
    </div>
  );
}

export default ChartTooltip;
