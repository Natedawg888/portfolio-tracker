import { formatNzd } from '../../api/client';
import { seriesColour } from '../AssetLineChart';
import { dayAriaLabel, type CalendarDay } from '../../pages/billsView';

export function CalendarStrip({
  days,
  selected,
  onSelect,
}: {
  days: CalendarDay[];
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="bills-strip" role="group" aria-label="Next 30 days">
      {days.map((day, i) => (
        <button
          key={day.date}
          type="button"
          className={`bills-day${day.isToday ? ' bills-day-today' : ''}`}
          aria-pressed={selected === day.date}
          aria-current={day.isToday ? 'date' : undefined}
          aria-label={dayAriaLabel(day, formatNzd)}
          onClick={() => onSelect(day.date)}
        >
          <span className="bills-day-weekday">{day.weekday}</span>
          <span className="bills-day-date">{day.dayOfMonth}</span>
          <span className="bills-day-month">{i === 0 || day.dayOfMonth === 1 ? day.month : ' '}</span>
          <span className="bills-day-dots" aria-hidden="true">
            {day.items.map((o) => (
              <span key={o.itemId} className="bills-dot" style={{ background: seriesColour(o.colourIndex) }} />
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}
