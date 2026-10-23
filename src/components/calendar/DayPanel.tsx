/**
 * The selected day, beside the grid (below it on narrow screens): its holiday, its events, or
 * "Nothing on this day." Choosing an event shows its details here, with a link back to the day.
 * Earnings details say only what Finnhub gives: the report date, the session if any, and never
 * a time. Business meetings are edited on their business's page; personal ones open the form.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { formatNzd } from '../../api/client';
import { amountLabel, marketValueNzd, type Holding } from '../../lib/holdingDisplay';
import {
  businessColourSlot,
  dayLabel,
  earningsDateLine,
  earningsTiming,
  quarterLabel,
  shortDayLabel,
  timeSpan,
  videoLink,
  type CalendarItem,
} from '../../lib/calendarView';
import type { BusinessMeeting } from '../../types';

function ItemRow({ item, onOpen }: { item: CalendarItem; onOpen: (item: CalendarItem) => void }) {
  if (item.kind === 'earnings') {
    const e = item.earnings;
    return (
      <li>
        <button type="button" className="calendar-panel-item calendar-panel-item--earnings" onClick={() => onOpen(item)}>
          <span className="calendar-panel-icon" aria-hidden="true">📈</span>
          <span className="calendar-panel-text">
            <span>{e.symbol} earnings call</span>
            <span className="muted small">{[quarterLabel(e), e.nzDateKnown ? 'Time to be confirmed' : 'US date · NZ time to be confirmed'].filter(Boolean).join(' · ')}</span>
          </span>
        </button>
      </li>
    );
  }
  const m = item.meeting;
  return (
    <li>
      <button
        type="button"
        className={`calendar-panel-item calendar-panel-item--${m.businessId ? `biz calendar-biz-${businessColourSlot(m.businessId)}` : 'personal'} calendar-panel-item--${m.status}`}
        onClick={() => onOpen(item)}
      >
        <span className="calendar-panel-icon" aria-hidden="true">{m.businessId ? '●' : '◆'}</span>
        <span className="calendar-panel-text">
          <span>
            {m.title}
            {m.status !== 'scheduled' ? <span className="muted small"> · {m.status === 'done' ? 'Done' : 'Cancelled'}</span> : null}
          </span>
          <span className="muted small">{[timeSpan(m), m.clientName, m.businessId ? m.businessName : m.kind === 'event' ? 'Event' : 'Personal'].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
    </li>
  );
}

function MeetingDetails({ m, onEditPersonal }: { m: BusinessMeeting; onEditPersonal: (m: BusinessMeeting) => void }) {
  const link = videoLink(m.location);
  return (
    <>
      <h3 className="calendar-panel-title">{m.title}</h3>
      <dl className="calendar-details">
        {m.clientName ? (
          <div>
            <dt>Client</dt>
            <dd>{m.clientName}</dd>
          </div>
        ) : null}
        <div>
          <dt>When</dt>
          <dd>
            {dayLabel(m.date)}, {timeSpan(m)} (NZ)
            {m.status !== 'scheduled' ? ` · ${m.status === 'done' ? 'Done' : 'Cancelled'}` : ''}
          </dd>
        </div>
        <div>
          <dt>{m.businessId ? 'Business' : 'Type'}</dt>
          <dd>{m.businessId ? <Link to={`/business/${encodeURIComponent(m.businessId)}`}>{m.businessName || 'Business'}</Link> : m.kind === 'event' ? 'Personal event' : 'Personal meeting'}</dd>
        </div>
        {m.location ? (
          <div>
            <dt>{link ? 'Video call' : 'Where'}</dt>
            <dd>
              {link ? (
                <a href={link} target="_blank" rel="noreferrer noopener">
                  Join call ↗
                </a>
              ) : (
                m.location
              )}
            </dd>
          </div>
        ) : null}
        {m.notes ? (
          <div>
            <dt>Notes</dt>
            <dd className="calendar-notes">{m.notes}</dd>
          </div>
        ) : null}
      </dl>
      <div className="row gap calendar-panel-actions">
        {m.businessId ? (
          <>
            {m.clientId && m.status !== 'cancelled' ? (
              <Link className="btn primary" to={`/business/invoices/new?business=${encodeURIComponent(m.businessId)}&client=${encodeURIComponent(m.clientId)}`}>
                Create invoice
              </Link>
            ) : null}
            <Link className="btn" to={`/business/${encodeURIComponent(m.businessId)}?meeting=${encodeURIComponent(m.id)}`}>
              Edit on Business ›
            </Link>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => onEditPersonal(m)}>
            Edit
          </button>
        )}
      </div>
    </>
  );
}

function EarningsDetails({ item, holding }: { item: Extract<CalendarItem, { kind: 'earnings' }>; holding: Holding | null }) {
  const e = item.earnings;
  const value = holding ? marketValueNzd(holding) : null;
  const quarter = quarterLabel(e);
  return (
    <>
      <h3 className="calendar-panel-title">
        {e.symbol} earnings call{quarter ? <span className="muted"> · {quarter}</span> : null}
      </h3>
      <dl className="calendar-details">
        <div>
          <dt>Date</dt>
          <dd>{earningsDateLine(e)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{earningsTiming(e)}</dd>
        </div>
        {holding ? (
          <div>
            <dt>You hold</dt>
            <dd>
              {amountLabel(holding)}
              {value != null ? ` · ${formatNzd(value)}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="muted small">
        Report date from Finnhub, which doesn’t give the call time or say whether the company has confirmed the date. Check the company’s investor page before
        relying on it.
      </p>
      {holding?.id ? (
        <div className="row gap calendar-panel-actions">
          <Link className="btn" to={`/news?holding=${encodeURIComponent(holding.id)}`}>
            News
          </Link>
        </div>
      ) : null}
    </>
  );
}

export function DayPanel({ date, today, holiday, items, detail, holdingFor, onOpen, onBack, onAdd, onEditPersonal }: {
  date: string;
  today: string;
  holiday: string | null;
  items: CalendarItem[];
  /** The event whose details are showing; null shows the day. */
  detail: CalendarItem | null;
  holdingFor: (symbol: string) => Holding | null;
  onOpen: (item: CalendarItem) => void;
  onBack: () => void;
  onAdd: (date: string) => void;
  onEditPersonal: (m: BusinessMeeting) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Move focus to the panel's heading when it switches between a day and an event's details.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [detail?.key]);

  return (
    <aside className="panel calendar-panel" aria-labelledby="calendar-panel-heading">
      {detail ? (
        <>
          <button type="button" className="link-btn calendar-back" onClick={onBack}>
            ‹ Back to {shortDayLabel(date)}
          </button>
          <h2 id="calendar-panel-heading" ref={headingRef} tabIndex={-1} className="sr-only">
            Details
          </h2>
          {detail.kind === 'earnings' ? <EarningsDetails item={detail} holding={holdingFor(detail.earnings.symbol)} /> : <MeetingDetails m={detail.meeting} onEditPersonal={onEditPersonal} />}
        </>
      ) : (
        <>
          <h2 id="calendar-panel-heading" ref={headingRef} tabIndex={-1} className="calendar-panel-day">
            {date === today ? `Today · ${shortDayLabel(date)}` : dayLabel(date)}
          </h2>
          {holiday ? (
            <p className="calendar-panel-holiday">
              <strong>Public holiday:</strong> {holiday}
            </p>
          ) : null}
          {items.length === 0 ? (
            <p className="muted">Nothing on this day.</p>
          ) : (
            <ul className="calendar-panel-list">
              {items.map((item) => (
                <ItemRow key={item.key} item={item} onOpen={onOpen} />
              ))}
            </ul>
          )}
          <button type="button" className="btn calendar-panel-add" onClick={() => onAdd(date)}>
            + Meeting or event on {shortDayLabel(date)}
          </button>
        </>
      )}
    </aside>
  );
}
