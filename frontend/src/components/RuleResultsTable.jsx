import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { getRuleMeta } from '../constants/ruleMeta';
import { getLevelMeta } from '../constants/levels';
import { firedResults, passedResults } from '../utils/explain';
import { Tooltip } from './ui';

/**
 * RuleResultsTable({ results, level })
 * Every rule with its icon/color, Fired (level-colored) / Passed (muted) badge, points and reason.
 * Passed rows are collapsed under "Show N passed checks".
 */
function RuleCell({ result }) {
  const meta = getRuleMeta(result.rule_name, result.display_name);
  const Icon = meta.icon;
  const color = `var(${meta.cssVar}, ${'currentColor'})`;
  const label = (
    <span className="rrt__rule">
      <span className="rrt__rule-icon" style={{ '--rule-color': color }} aria-hidden="true">
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <span className="rrt__rule-text">
        <span className="rrt__rule-name">{meta.displayName}</span>
        <span className="rrt__rule-id">{result.rule_name}</span>
      </span>
    </span>
  );
  return result.description ? (
    <Tooltip content={result.description} placement="top">
      {label}
    </Tooltip>
  ) : (
    label
  );
}

function ResultBadge({ triggered, level }) {
  if (triggered) {
    const lm = getLevelMeta(level);
    return (
      <span
        className="rrt__badge rrt__badge--fired"
        style={{ '--badge-bg': lm.soft, '--badge-fg': lm.onSoft, '--badge-dot': lm.color }}
      >
        <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" />
        Fired
      </span>
    );
  }
  return (
    <span className="rrt__badge rrt__badge--passed">
      <Check size={14} strokeWidth={1.75} aria-hidden="true" />
      Passed
    </span>
  );
}

function Row({ result, level }) {
  const fired = !!result.triggered;
  const points = Number(result.score) || 0;
  return (
    <tr className={fired ? 'rrt__row rrt__row--fired' : 'rrt__row rrt__row--passed'}>
      <td className="rrt__cell rrt__cell--rule">
        <RuleCell result={result} />
      </td>
      <td className="rrt__cell rrt__cell--result">
        <ResultBadge triggered={fired} level={level} />
      </td>
      <td className="rrt__cell rrt__cell--points num">
        {fired ? `+${points}` : <span className="rrt__muted">0</span>}
      </td>
      <td className="rrt__cell rrt__cell--reason">{result.reason || '—'}</td>
    </tr>
  );
}

export default function RuleResultsTable({ results = [], level }) {
  const [showPassed, setShowPassed] = useState(false);
  const fired = firedResults(results);
  const passed = passedResults(results);

  if (!results.length) {
    return <p className="rrt__empty">No rule results were recorded for this transaction.</p>;
  }

  return (
    <div className="rrt">
      <div className="rrt__scroll">
        <table className="rrt__table">
          <caption className="sr-only">Rule results for this transaction</caption>
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Result</th>
              <th scope="col" className="num">
                Points
              </th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {fired.map((r) => (
              <Row key={r.rule_name} result={r} level={level} />
            ))}
            {showPassed && passed.map((r) => <Row key={r.rule_name} result={r} level={level} />)}
          </tbody>
        </table>
      </div>
      {passed.length > 0 && (
        <button
          type="button"
          className="rrt__toggle"
          aria-expanded={showPassed}
          onClick={() => setShowPassed((v) => !v)}
        >
          {showPassed ? (
            <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
          )}
          {showPassed
            ? `Hide ${passed.length} passed check${passed.length === 1 ? '' : 's'}`
            : `Show ${passed.length} passed check${passed.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}
