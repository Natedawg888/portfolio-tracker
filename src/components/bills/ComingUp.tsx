import { formatNzd } from '../../api/client';
import { seriesColour } from '../AssetLineChart';
import { relativeDay, shortDate, type Occurrence } from '../../pages/billsView';

export function ComingUp({
  occurrences,
  selected,
  onClear,
}: {
  occurrences: Occurrence[];
  selected: string | null;
  onClear: () => void;
}) {
  const shown = selected ? occurrences.filter((o) => o.date === selected) : occurrences;
  return (
    <div className="bills-coming">
      <div className="bills-coming-head">
        <h3>{selected ? `Coming up on ${shortDate(selected)}` : 'Coming up'}</h3>
        {selected ? (
          <button type="button" className="link-btn" onClick={onClear}>
            Show all
          </button>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className="muted small">{selected ? `Nothing due on ${shortDate(selected)}` : 'Nothing due in the next 30 days.'}</p>
      ) : (
        <ul className="bills-coming-list">
          {shown.map((o) => (
            <li key={`${o.itemId}:${o.date}`} className="bills-coming-row">
              <span className="bills-coming-date">{shortDate(o.date)}</span>
              <span className="bills-dot" aria-hidden="true" style={{ background: seriesColour(o.colourIndex) }} />
              <span className="bills-coming-name">{o.name}</span>
              <span className={`bills-coming-when${o.daysAway <= 1 ? ' bills-coming-soon' : ''}`}>{relativeDay(o.daysAway)}</span>
              <span className="bills-coming-amount money">{formatNzd(o.amountNzd)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
