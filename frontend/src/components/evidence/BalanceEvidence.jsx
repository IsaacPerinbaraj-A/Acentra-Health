import { Wallet } from 'lucide-react';
import { Card } from '../ui';
import { getLevelMeta, normalizeLevel } from '../../constants/levels';
import { formatINR, formatPercent } from '../../utils/format';
import '../../styles/pages/evidence.css';

/**
 * Balance-drain evidence card: amount as a share of the balance before the payment.
 * Props: details (balance_drain details) or result ({details}), level, currency='INR'.
 */
export default function BalanceEvidence({ details, result, level, currency = 'INR', className = '' }) {
  const d = details || result?.details || {};
  const lvl = normalizeLevel(level) || 'HIGH';
  const meta = getLevelMeta(lvl);
  const amount = Number(d.amount);
  const balance = Number(d.account_balance);
  const ratio =
    Number.isFinite(Number(d.ratio)) && d.ratio !== null
      ? Number(d.ratio)
      : balance > 0
        ? amount / balance
        : null;
  const maxRatio = Number.isFinite(Number(d.max_ratio)) && d.max_ratio !== null ? Number(d.max_ratio) : 0.8;
  const fillPct = ratio === null ? 0 : Math.max(0, Math.min(1, ratio)) * 100;
  const markerPct = Math.max(0, Math.min(1, maxRatio)) * 100;
  const remaining = Number.isFinite(amount) && Number.isFinite(balance) ? balance - amount : null;
  const over = ratio !== null && ratio >= maxRatio;

  const figures = `${formatINR(amount, currency)} of ${formatINR(balance, currency)} (${formatPercent(ratio)})`;

  return (
    <Card
      title="Balance"
      subtitle="Payment as a share of the available balance"
      icon={Wallet}
      className={`ev-card ${className}`.trim()}
      style={{ '--ev-level': meta.color, '--ev-level-soft': meta.soft, '--ev-level-on-soft': meta.onSoft }}
    >
      <div className="ev-balance">
        <div className="ev-balance__figures">
          <span className="ev-balance__main">{figures}</span>
          {over && <span className="ev-ratio">Above {formatPercent(maxRatio)} threshold</span>}
        </div>
        <div
          className="ev-balance__track"
          role="img"
          aria-label={`${figures}; threshold ${formatPercent(maxRatio)} of balance`}
        >
          <div className="ev-balance__fill" style={{ width: `${fillPct}%` }} />
          <div className="ev-balance__marker" style={{ left: `${markerPct}%` }}>
            <span className="ev-balance__marker-label">{formatPercent(maxRatio)}</span>
          </div>
        </div>
        <div className="ev-balance__scale" aria-hidden="true">
          <span>{formatINR(0, currency)}</span>
          <span>{formatINR(balance, currency)}</span>
        </div>
        <dl className="ev-stats ev-stats--3 ev-stats--compact">
          <div className="ev-stat">
            <dt className="ev-stat__label">Payment</dt>
            <dd className="ev-stat__value ev-stat__value--level">{formatINR(amount, currency)}</dd>
          </div>
          <div className="ev-stat">
            <dt className="ev-stat__label">Balance before</dt>
            <dd className="ev-stat__value">{formatINR(balance, currency)}</dd>
          </div>
          <div className="ev-stat">
            <dt className="ev-stat__label">Left after</dt>
            <dd className="ev-stat__value">{remaining === null ? '—' : formatINR(remaining, currency)}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
