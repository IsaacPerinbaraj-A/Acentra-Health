import { Link } from 'react-router-dom';
import { ArrowRight, FlaskConical, MinusCircle, PlusCircle, X } from 'lucide-react';
import { IconButton, Pill } from '../../components/ui';
import { FLAG_LEVELS, getLevelMeta } from '../../constants/levels';
import { formatNumber } from '../../utils/format';

const MAX_CHIPS = 24;

function Delta({ from, to }) {
  const d = (to || 0) - (from || 0);
  if (d === 0) return <span className="rules-bt__delta is-zero">No change</span>;
  return (
    <span className={`rules-bt__delta ${d > 0 ? 'is-up' : 'is-down'}`}>
      {d > 0 ? '+' : '−'}
      {formatNumber(Math.abs(d))}
    </span>
  );
}

function IdChips({ ids, tone }) {
  if (!ids?.length) return <p className="rules-bt__none">None</p>;
  const shown = ids.slice(0, MAX_CHIPS);
  const extra = ids.length - shown.length;
  return (
    <div className="rules-bt__chips">
      {shown.map((id) => (
        <Link
          key={id}
          to={`/transactions?q=${encodeURIComponent(id)}`}
          className={`rules-bt__chip is-${tone}`}
          title={`Open ${id} in Transactions`}
        >
          {id}
        </Link>
      ))}
      {extra > 0 && <span className="rules-bt__more">+{formatNumber(extra)} more</span>}
    </div>
  );
}

/** Comparison of current vs simulated flags from POST /api/rules/backtest. */
export default function BacktestPanel({ result, onClose }) {
  if (!result) return null;
  const cur = result.current || { flagged: 0, by_level: {} };
  const sim = result.simulated || { flagged: 0, by_level: {} };
  const newly = result.newly_flagged || [];
  const gone = result.no_longer_flagged || [];

  return (
    <section className="rules-bt" aria-label="Backtest results">
      <header className="rules-bt__head">
        <span className="rules-bt__title">
          <FlaskConical size={16} aria-hidden="true" />
          Backtest with your unsaved changes
        </span>
        <IconButton icon={X} label="Close backtest results" size="sm" onClick={onClose} />
      </header>
      <p className="rules-bt__note">Simulated over stored transactions. Nothing was saved.</p>

      <div className="rules-bt__summary">
        <div className="rules-bt__stat">
          <span className="rules-bt__label">Currently flagged</span>
          <span className="rules-bt__value">{formatNumber(cur.flagged)}</span>
        </div>
        <ArrowRight size={18} className="rules-bt__arrow" aria-hidden="true" />
        <div className="rules-bt__stat">
          <span className="rules-bt__label">Would be flagged</span>
          <span className="rules-bt__value">{formatNumber(sim.flagged)}</span>
        </div>
        <Delta from={cur.flagged} to={sim.flagged} />
      </div>

      <table className="rules-bt__table">
        <thead>
          <tr>
            <th scope="col">Level</th>
            <th scope="col" className="is-num">Current</th>
            <th scope="col" className="is-num">Simulated</th>
            <th scope="col" className="is-num">Change</th>
          </tr>
        </thead>
        <tbody>
          {FLAG_LEVELS.map((lvl) => {
            const meta = getLevelMeta(lvl);
            const a = cur.by_level?.[lvl] || 0;
            const b = sim.by_level?.[lvl] || 0;
            return (
              <tr key={lvl}>
                <td>
                  <span className="rules-bt__level">
                    <span className={`rules-bt__dot is-${lvl.toLowerCase()}`} aria-hidden="true" />
                    {meta?.label || lvl}
                  </span>
                </td>
                <td className="is-num">{formatNumber(a)}</td>
                <td className="is-num">{formatNumber(b)}</td>
                <td className="is-num">
                  <Delta from={a} to={b} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="rules-bt__lists">
        <div>
          <h4 className="rules-bt__list-title">
            <PlusCircle size={14} aria-hidden="true" />
            Newly flagged
            <Pill tone={newly.length ? 'warning' : 'neutral'}>{formatNumber(newly.length)}</Pill>
          </h4>
          <IdChips ids={newly} tone="new" />
        </div>
        <div>
          <h4 className="rules-bt__list-title">
            <MinusCircle size={14} aria-hidden="true" />
            No longer flagged
            <Pill tone={gone.length ? 'success' : 'neutral'}>{formatNumber(gone.length)}</Pill>
          </h4>
          <IdChips ids={gone} tone="gone" />
        </div>
      </div>
    </section>
  );
}
