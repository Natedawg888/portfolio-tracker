/**
 * The month grid: role="grid" with one focusable cell at a time (arrow keys move, Home/End go to
 * the week's ends, Enter or Space selects). Each cell is labelled with its date, holiday and
 * events ("Wed 28 Oct, MSFT earnings call, 10am Review with Tui Ltd"). Up to three chips show,
 * then "+N more". Chips are pointer shortcuts to an event's details; keyboard users reach the
 * same details from the day panel, so chips aren't extra tab stops.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { addDays } from '../../lib/nzTime';
import { businessColourSlot, cellLabel, chipOverflow, monthLabel, type CalendarItem } from '../../lib/calendarView';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Chip({ item, onOpen }: { item: CalendarItem; onOpen: (item: CalendarItem) => void }) {
  if (item.kind === 'earnings') {
    return (
      <button type="button" tabIndex={-1} aria-hidden="true" className="calendar-chip calendar-chip--earnings" onClick={(e) => { e.stopPropagation(); onOpen(item); }}>
        <span className="calendar-chip-icon">📈</span> {item.earnings.symbol}
      </button>
    );
  }
  const m = item.meeting;
  const business = m.businessId != null;
  const cls = business ? `calendar-chip--biz calendar-biz-${businessColourSlot(m.businessId!)}` : 'calendar-chip--personal';
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      className={`calendar-chip ${cls} calendar-chip--${m.status}`}
      onClick={(e) => { e.stopPropagation(); onOpen(item); }}
    >
      <span className="calendar-chip-icon">{business ? '●' : '◆'}</span>
      <span className="calendar-chip-time">{m.time.replace(/^0/, '')}</span> {business ? m.clientName || m.title : m.title}
    </button>
  );
}

export function CalendarGrid({ month, weeks, today, selected, byDay, holidays, onSelect, onOpen, onMonthEdge }: {
  month: string;
  weeks: { date: string; inMonth: boolean }[][];
  today: string;
  selected: string;
  byDay: Map<string, CalendarItem[]>;
  holidays: Map<string, string>;
  onSelect: (date: string) => void;
  onOpen: (item: CalendarItem) => void;
  /** Arrow keys past the grid's first or last day move to the next or previous month. */
  onMonthEdge: (date: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dates = weeks.flat().map((d) => d.date);
  const focusDate = dates.includes(selected) ? selected : (weeks.flat().find((d) => d.date === today)?.date ?? `${month}-01`);
  const wantFocus = useRef(false);

  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${focusDate}"]`)?.focus();
  }, [focusDate]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-date]');
    if (!target) return;
    const date = target.dataset.date!;
    const i = dates.indexOf(date);
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      e.preventDefault();
      const next = addDays(date, step[e.key]);
      wantFocus.current = true;
      if (dates.includes(next)) onSelect(next);
      else onMonthEdge(next);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const rowStart = i - (i % 7);
      wantFocus.current = true;
      onSelect(dates[e.key === 'Home' ? rowStart : rowStart + 6]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(date);
    }
  }

  return (
    <div ref={gridRef} className="panel calendar-grid" role="grid" aria-label={monthLabel(month)} onKeyDown={onKeyDown}>
      <div role="row" className="calendar-grid-row">
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="calendar-weekday muted small">
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0].date} role="row" className="calendar-grid-row">
          {week.map((day) => {
            const items = byDay.get(day.date) ?? [];
            const holiday = holidays.get(day.date) ?? null;
            const { shown, more } = chipOverflow(items);
            const isSelected = day.date === selected;
            return (
              <div
                key={day.date}
                role="gridcell"
                data-date={day.date}
                tabIndex={day.date === focusDate ? 0 : -1}
                aria-selected={isSelected}
                aria-current={day.date === today ? 'date' : undefined}
                aria-label={cellLabel(day.date, holiday, items)}
                className={
                  'calendar-day' +
                  (day.inMonth ? '' : ' calendar-day--other') +
                  (day.date === today ? ' calendar-day--today' : '') +
                  (isSelected ? ' calendar-day--selected' : '') +
                  (holiday ? ' calendar-day--holiday' : '')
                }
                onClick={() => onSelect(day.date)}
              >
                <span className="calendar-day-num" aria-hidden="true">
                  {Number(day.date.slice(8))}
                </span>
                {holiday ? (
                  <span className="calendar-holiday-name" aria-hidden="true">
                    {holiday}
                  </span>
                ) : null}
                {shown.map((item) => (
                  <Chip key={item.key} item={item} onOpen={onOpen} />
                ))}
                {more ? (
                  <span className="calendar-more" aria-hidden="true">
                    +{more} more
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
