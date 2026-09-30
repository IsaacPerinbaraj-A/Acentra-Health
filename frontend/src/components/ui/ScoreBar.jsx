import { getLevelMeta, levelFromScore, normalizeLevel } from '../../constants/levels.js';
import '../../styles/ui-display.css';

/** ScoreBar({ score, level }) — inline 56 × 6 px track + level-colored fill, score number beside it. */
export function ScoreBar({ score, level, className = '' }) {
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  const m = getLevelMeta(normalizeLevel(level) || levelFromScore(value));
  return (
    <span
      className={`score-bar${className ? ` ${className}` : ''}`}
      style={{ '--bar-color': m.color }}
      role="img"
      aria-label={`Score ${Math.round(value)} of 100, ${m.label}`}
    >
      <span className="score-bar__track" aria-hidden="true">
        <span className="score-bar__fill" style={{ width: `${value}%` }} />
      </span>
      <span className="score-bar__value" aria-hidden="true">
        {Math.round(value)}
      </span>
    </span>
  );
}

export default ScoreBar;
