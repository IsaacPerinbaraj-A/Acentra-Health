import { useEffect, useState } from 'react';
import { getLevelMeta, levelFromScore, normalizeLevel } from '../../constants/levels.js';
import '../../styles/ui-display.css';

/**
 * ScoreGauge({ score, level, size = 96 })
 * 270° SVG arc: --surface-2 track, level-colored fill animating from 0 on mount,
 * centred tabular score with "/100"; level label underneath (hidden below 64 px).
 */
export function ScoreGauge({ score, level, size = 96, showLabel, className = '' }) {
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  const lvl = normalizeLevel(level) || levelFromScore(value);
  const m = getLevelMeta(lvl);
  const small = size < 64;
  const stroke = small ? 4 : size >= 120 ? 10 : 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let raf2;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(value));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [value]);

  const fill = (arc * shown) / 100;
  const labelVisible = showLabel ?? !small;
  const numSize = Math.round(size * (small ? 0.34 : 0.27));

  return (
    <div
      className={`score-gauge${small ? ' score-gauge--sm' : ''}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={`Risk score ${Math.round(value)} out of 100, ${m.label}`}
      style={{ '--gauge-color': m.color, '--gauge-on-soft': m.onSoft, width: size }}
    >
      <div className="score-gauge__dial" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            className="score-gauge__track"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${c}`}
            transform={`rotate(135 ${size / 2} ${size / 2})`}
          />
          <circle
            className="score-gauge__fill"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${fill} ${c}`}
            opacity={shown > 0 ? 1 : 0}
            transform={`rotate(135 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="score-gauge__center">
          <span className="score-gauge__value" style={{ fontSize: numSize, lineHeight: 1 }}>
            {Math.round(value)}
          </span>
          {!small && <span className="score-gauge__max">/100</span>}
        </div>
      </div>
      {labelVisible && <span className="score-gauge__level">{m.label}</span>}
    </div>
  );
}

export default ScoreGauge;
