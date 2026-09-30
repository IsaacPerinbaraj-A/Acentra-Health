import { Flag, History } from 'lucide-react';
import { getStatusMeta } from '../constants/statuses';
import { formatDateTime, relativeTime } from '../utils/format';
import { Tooltip } from './ui';

/**
 * ActivityTimeline({ actions, createdAt })
 * actions: review_actions (newest first) [{id, from_status, to_status, note, created_at, username}]
 * createdAt (optional): flag creation time, rendered as the first (oldest) event.
 */
function When({ iso }) {
  if (!iso) return null;
  return (
    <Tooltip content={formatDateTime(iso)}>
      <time className="atl__time" dateTime={iso} tabIndex={0}>
        {relativeTime(iso)}
      </time>
    </Tooltip>
  );
}

function StatusText({ status }) {
  const m = getStatusMeta(status);
  return (
    <span className="atl__status" style={{ '--st-color': m.color }}>
      {m.label}
    </span>
  );
}

export default function ActivityTimeline({ actions = [], createdAt }) {
  const list = actions || [];
  if (!list.length && !createdAt) {
    return (
      <div className="atl__empty">
        <History size={16} strokeWidth={1.75} aria-hidden="true" />
        No review activity yet
      </div>
    );
  }

  return (
    <ol className="atl" aria-label="Review activity">
      {list.map((a) => {
        const m = getStatusMeta(a.to_status);
        const Icon = m.icon;
        return (
          <li key={a.id ?? `${a.created_at}-${a.to_status}`} className="atl__item">
            <span className="atl__dot" style={{ '--st-color': m.color }} aria-hidden="true">
              <Icon size={12} strokeWidth={2} />
            </span>
            <div className="atl__body">
              <div className="atl__line">
                <span className="atl__user">{a.username || 'system'}</span>
                <span className="atl__sep">:</span>
                <StatusText status={a.from_status} />
                <span className="atl__arrow" aria-label="to">
                  →
                </span>
                <StatusText status={a.to_status} />
              </div>
              {a.note ? <blockquote className="atl__note">{a.note}</blockquote> : null}
              <When iso={a.created_at} />
            </div>
          </li>
        );
      })}
      {createdAt ? (
        <li className="atl__item atl__item--origin">
          <span className="atl__dot atl__dot--origin" aria-hidden="true">
            <Flag size={12} strokeWidth={2} />
          </span>
          <div className="atl__body">
            <div className="atl__line">
              <span className="atl__user">Rule engine</span>
              <span className="atl__sep">:</span>
              <span>flagged for review</span>
            </div>
            <When iso={createdAt} />
          </div>
        </li>
      ) : null}
    </ol>
  );
}
