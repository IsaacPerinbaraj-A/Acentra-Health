import { getRuleMeta } from '../../constants/ruleMeta.js';
import { Tooltip } from './Tooltip.jsx';
import { RuleChip } from './RuleChip.jsx';
import '../../styles/ui-display.css';

const TICKS = [
  { at: 25, label: 'Medium' },
  { at: 50, label: 'High' },
  { at: 75, label: 'Critical' },
];

/**
 * ScoreBreakdown({ results, score, rawScore })
 * results: fired results [{ rule_name, display_name, score, reason }].
 * 12 px stacked bar 0-100, one segment per fired rule (rule color, tooltip with points + reason),
 * ticks at 25/50/75, legend chips with points, "Raw score N, capped at 100" note when capped.
 */
export function ScoreBreakdown({ results = [], score, rawScore, className = '' }) {
  const fired = (results || []).filter((r) => Number(r?.score) > 0);
  const total = fired.reduce((sum, r) => sum + Number(r.score), 0);
  const raw = rawScore != null ? Number(rawScore) : total;
  const finalScore = score != null ? Number(score) : Math.min(100, total);
  // Segments share the 0-100 scale; when the raw sum exceeds 100 they are scaled to fill the bar.
  const scale = total > 100 ? 100 / total : 1;

  return (
    <div className={`score-breakdown${className ? ` ${className}` : ''}`}>
      <div className="score-breakdown__bar-wrap">
        <div
          className="score-breakdown__bar"
          role="img"
          aria-label={`Score ${Math.round(finalScore)} of 100 from ${fired.length} fired rule${fired.length === 1 ? '' : 's'}`}
        >
          {fired.map((r, i) => {
            const meta = getRuleMeta(r.rule_name, r.display_name);
            const pts = Number(r.score);
            return (
              <Tooltip
                key={`${r.rule_name}-${i}`}
                className="score-breakdown__seg-wrap"
                style={{ width: `${pts * scale}%` }}
                content={
                  <span className="score-breakdown__tip">
                    <strong>
                      {meta.displayName} · +{pts} pts
                    </strong>
                    {r.reason && <span>{r.reason}</span>}
                  </span>
                }
              >
                <span
                  className="score-breakdown__seg"
                  style={{ '--rule-color': `var(${meta.cssVar})` }}
                  tabIndex={0}
                  aria-label={`${meta.displayName}: +${pts} points${r.reason ? `. ${r.reason}` : ''}`}
                />
              </Tooltip>
            );
          })}
        </div>
        {TICKS.map((t) => (
          <span key={t.at} className="score-breakdown__tick" style={{ left: `${t.at}%` }} aria-hidden="true">
            <span className="score-breakdown__tick-label">{t.label}</span>
          </span>
        ))}
      </div>
      <div className="score-breakdown__scale" aria-hidden="true">
        <span>0</span>
        <span>100</span>
      </div>
      {fired.length > 0 ? (
        <div className="score-breakdown__legend">
          {fired.map((r, i) => (
            <RuleChip key={`${r.rule_name}-${i}`} name={r.rule_name} label={r.display_name} points={Number(r.score)} />
          ))}
        </div>
      ) : (
        <p className="score-breakdown__empty">No rules fired for this transaction.</p>
      )}
      {raw > 100 && (
        <p className="score-breakdown__note">
          Raw score <span className="tabular-nums">{Math.round(raw)}</span>, capped at 100
        </p>
      )}
    </div>
  );
}

export default ScoreBreakdown;
