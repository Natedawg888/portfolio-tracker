/**
 * Calendar: what's coming up, as a month grid or an agenda list, in NZ time. Three layers, each
 * toggled by a filter pill: earnings calls for stocks the user holds (Finnhub report dates; never
 * a made-up time), client meetings from their businesses, and their own meetings and events. NZ
 * national public holidays are marked. Client meetings are booked on each business's page
 * (opening one here goes there); this page books personal meetings and events. A day panel
 * shows the selected day (today at first) and an event's details.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { errorText } from '../components/business/BusinessUi';
import { CalendarGrid } from '../components/calendar/CalendarGrid';
import { DayPanel } from '../components/calendar/DayPanel';
import { MeetingForm } from '../components/calendar/MeetingForm';
import {
  CALENDAR_LAYERS,
  agendaDays,
  businessColourSlot,
  gridRange,
  itemsByDate,
  layerCounts,
  meetingBody,
  monthGrid,
  monthLabel,
  newMeetingBody,
  quarterLabel,
  shiftMonth,
  timeSpan,
  toggleLayer,
  type CalendarItem,
  type CalendarLayer,
} from '../lib/calendarView';
import type { Holding } from '../lib/holdingDisplay';
import { addDays, utcToLocal } from '../lib/nzTime';
import type { BusinessMeeting, EarningsResponse, HolidaysResponse, MeetingStatus, MeetingWriteBody } from '../types';

type Editing = { meeting: BusinessMeeting | null; initial: MeetingWriteBody; n: number };
type View = 'month' | 'agenda';
const ALL_LAYERS = new Set<CalendarLayer>(CALENDAR_LAYERS.map((l) => l.id));
/** The agenda looks this far ahead from today. */
const AGENDA_DAYS = 120;

function narrowScreen(): boolean {
  try {
    return window.matchMedia('(max-width: 639px)').matches;
  } catch {
    return false;
  }
}

export function Calendar() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => utcToLocal(Date.now()).date);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<View>(() => (narrowScreen() ? 'agenda' : 'month'));
  const [layers, setLayers] = useState<Set<CalendarLayer>>(ALL_LAYERS);
  const [selected, setSelected] = useState(today);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<BusinessMeeting[] | null>(null);
  const [earnings, setEarnings] = useState<EarningsResponse | null>(null);
  const [holidayData, setHolidayData] = useState<HolidaysResponse | null>(null);
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [businessCount, setBusinessCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reload, setReload] = useState(0);

  // Older links (?new=1&business=&client=) booked business meetings here; they now belong on the
  // business page. Without a business, ?new=1 opens a personal entry.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    const business = params.get('business');
    if (business) {
      const client = params.get('client');
      navigate(`/business/${encodeURIComponent(business)}?meeting=new${client ? `&client=${encodeURIComponent(client)}` : ''}`, { replace: true });
      return;
    }
    setEditing({ meeting: null, initial: newMeetingBody({ businessId: null, date: today }), n: 0 });
    setParams({}, { replace: true });
  }, [params, navigate, setParams, today]);

  useEffect(() => {
    let cancelled = false;
    api.holdings
      .list()
      .then((list) => {
        if (!cancelled) setHoldings(list as Holding[]);
      })
      .catch(() => {
        if (!cancelled) setHoldings([]);
      });
    api.business
      .list()
      .then((l) => {
        if (!cancelled) setBusinessCount(l.businesses.length);
      })
      .catch(() => {
        if (!cancelled) setBusinessCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The month view loads its grid's weeks; the agenda loads from today ahead.
  const range = useMemo(() => (view === 'month' ? gridRange(month) : { from: today, to: addDays(today, AGENDA_DAYS) }), [view, month, today]);
  useEffect(() => {
    let cancelled = false;
    api.calendar
      .range(range.from, range.to)
      .then((r) => {
        if (!cancelled) setMeetings(r.meetings);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e, 'Could not load the calendar.'));
      });
    api.calendar
      .earnings(range.from, range.to)
      .then((r) => {
        if (!cancelled) setEarnings(r);
      })
      .catch(() => {
        if (!cancelled) setEarnings({ status: 'unavailable', events: [], uncovered: [], failed: [] });
      });
    api.calendar
      .holidays(range.from, range.to)
      .then((r) => {
        if (!cancelled) setHolidayData(r);
      })
      .catch(() => {
        if (!cancelled) setHolidayData({ available: false, holidays: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [range, reload]);

  const stocks = useMemo(() => (holdings ?? []).filter((h) => h.assetClass === 'stock'), [holdings]);
  const holdingFor = (symbol: string) => stocks.find((h) => (h.symbol ?? '').toUpperCase() === symbol.toUpperCase()) ?? null;
  const holidays = useMemo(() => new Map((holidayData?.holidays ?? []).map((h) => [h.date, h.name])), [holidayData]);
  const earningsEvents = useMemo(() => earnings?.events ?? [], [earnings]);
  const byDay = useMemo(() => itemsByDate(meetings ?? [], earningsEvents, layers), [meetings, earningsEvents, layers]);
  const counts = useMemo(() => {
    const inScope = (d: string) => (view === 'month' ? d.startsWith(month) : d >= today);
    return layerCounts((meetings ?? []).filter((m) => inScope(m.date)), view === 'month' ? month : '', earningsEvents.filter((e) => inScope(e.nzDate)).length);
  }, [meetings, earningsEvents, view, month, today]);
  const dayItems = byDay.get(selected) ?? [];
  const detail = detailKey ? (dayItems.find((i) => i.key === detailKey) ?? null) : null;
  const weeks = useMemo(() => monthGrid(month), [month]);
  const agenda = useMemo(() => agendaDays(byDay, holidays, today, today), [byDay, holidays, today]);

  function select(date: string) {
    setSelected(date);
    setDetailKey(null);
  }
  function openItem(item: CalendarItem) {
    setSelected(item.kind === 'earnings' ? item.earnings.nzDate : item.meeting.date);
    setDetailKey(item.key);
  }
  function goToMonth(m: string) {
    setMonth(m);
    setDetailKey(null);
  }

  const openNew = (date = selected) =>
    setEditing((prev) => ({ meeting: null, initial: newMeetingBody({ businessId: null, date }), n: (prev?.n ?? 0) + 1 }));
  const editPersonal = (m: BusinessMeeting) => setEditing((prev) => ({ meeting: m, initial: meetingBody(m), n: (prev?.n ?? 0) + 1 }));
  const done = () => {
    setEditing(null);
    setReload((n) => n + 1);
  };

  async function save(body: MeetingWriteBody) {
    if (editing?.meeting) await api.calendar.updateMeeting(editing.meeting.id, body);
    else await api.calendar.createMeeting(body);
    setMonth(body.date.slice(0, 7));
    select(body.date);
    done();
  }

  async function setStatus(status: MeetingStatus) {
    if (!editing?.meeting) return;
    await api.calendar.setStatus(editing.meeting.id, status);
    done();
  }

  const scopeLabel = view === 'month' ? monthLabel(month) : `the next ${AGENDA_DAYS} days`;
  const earningsNote =
    holdings != null && stocks.length === 0
      ? null
      : earnings?.status === 'not_configured'
        ? 'Earnings data isn’t connected yet.'
        : earnings?.status === 'unavailable'
          ? 'Couldn’t reach the earnings data just now. Nothing is shown in its place.'
          : [
              earnings?.failed.length ? `Couldn’t load ${earnings.failed.join(', ')} just now.` : null,
              earnings?.uncovered.length ? `${earnings.uncovered.join(', ')}: not covered (US-listed stocks only).` : null,
            ]
              .filter(Boolean)
              .join(' ') || null;

  return (
    <div className="stack bills-page warranties-page rentals-page calendar-page">
      <header className="warranties-header">
        <div>
          <h2 className="page-title">Calendar</h2>
          <p className="muted small">Earnings calls for stocks you hold, client meetings from your businesses, and your own meetings and events · NZ time</p>
        </div>
        <div className="warranties-header-actions">
          <button type="button" className="btn small primary calendar-add" onClick={() => openNew()}>
            + Meeting or event
          </button>
        </div>
      </header>

      {error ? <p className="auth-error" role="alert">{error}</p> : null}

      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button
            type="button"
            className="btn calendar-today"
            onClick={() => {
              goToMonth(today.slice(0, 7));
              select(today);
            }}
          >
            Today
          </button>
          {view === 'month' ? (
            <>
              <button type="button" className="btn calendar-step" aria-label="Previous month" onClick={() => goToMonth(shiftMonth(month, -1))}>
                ‹
              </button>
              <h3 className="calendar-month" aria-live="polite">
                {monthLabel(month)}
              </h3>
              <button type="button" className="btn calendar-step" aria-label="Next month" onClick={() => goToMonth(shiftMonth(month, 1))}>
                ›
              </button>
            </>
          ) : (
            <h3 className="calendar-month">Coming up</h3>
          )}
        </div>
        <div className="segmented calendar-view-toggle" role="group" aria-label="Calendar view">
          {(['month', 'agenda'] as const).map((v) => (
            <button key={v} type="button" className={`segmented-btn${view === v ? ' active' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'month' ? 'Month' : 'Agenda'}
            </button>
          ))}
        </div>
      </div>

      <div className="calendar-layers">
        <div className="calendar-pills" role="group" aria-label="Show on the calendar">
          {CALENDAR_LAYERS.map((l) => {
            // With nothing to show, a pill becomes a way to set that layer up.
            if (l.id === 'earnings' && holdings != null && stocks.length === 0) {
              return (
                <Link key={l.id} className="calendar-pill calendar-pill--setup" to="/portfolio">
                  <span className="calendar-pill-icon" aria-hidden="true">{l.icon}</span>
                  Add stocks in Portfolio to see their earnings calls ›
                </Link>
              );
            }
            if (l.id === 'business' && businessCount === 0) {
              return (
                <Link key={l.id} className="calendar-pill calendar-pill--setup" to="/business">
                  <span className="calendar-pill-icon" aria-hidden="true">{l.icon}</span>
                  Client meetings: set up a business ›
                </Link>
              );
            }
            const on = layers.has(l.id);
            return (
              <button
                key={l.id}
                type="button"
                className={`calendar-pill calendar-pill--${l.id}${on ? ' active' : ''}`}
                aria-pressed={on}
                onClick={() => setLayers((s) => toggleLayer(s, l.id))}
              >
                <span className="calendar-pill-icon" aria-hidden="true">
                  {l.icon}
                </span>
                {l.label}
                <span className="calendar-pill-count">
                  <span className="sr-only">, </span>
                  {counts[l.id]}
                  <span className="sr-only"> in {scopeLabel}</span>
                </span>
              </button>
            );
          })}
        </div>
        {businessCount !== 0 ? (
          <Link className="calendar-book-link" to="/business">
            Book meetings on the Business page ›
          </Link>
        ) : null}
      </div>
      {earningsNote ? <p className="muted small calendar-source-note">{earningsNote}</p> : null}
      {holidayData && !holidayData.available ? <p className="muted small calendar-source-note">Public holidays couldn’t be loaded just now.</p> : null}

      {meetings == null && !error ? <p className="muted">Loading…</p> : null}

      {meetings ? (
        <div className="calendar-body">
          {view === 'month' ? (
            <CalendarGrid
              month={month}
              weeks={weeks}
              today={today}
              selected={selected}
              byDay={byDay}
              holidays={holidays}
              onSelect={select}
              onOpen={openItem}
              onMonthEdge={(date) => {
                goToMonth(date.slice(0, 7));
                select(date);
              }}
            />
          ) : (
            <section className="calendar-agenda" aria-label="Coming up">
              {agenda.length === 0 ? (
                <p className="panel muted">Nothing coming up in the next {AGENDA_DAYS} days.</p>
              ) : (
                agenda.map((day) => (
                  <section key={day.date} className="panel calendar-agenda-day" aria-labelledby={`agenda-${day.date}`}>
                    <h3 id={`agenda-${day.date}`} className="calendar-agenda-heading">
                      {day.heading}
                      {day.holiday ? <span className="calendar-agenda-holiday"> · {day.holiday}</span> : null}
                    </h3>
                    {day.items.length ? (
                      <ul className="calendar-agenda-list">
                        {day.items.map((item) => (
                          <li key={item.key}>
                            <button type="button" className={`calendar-agenda-row${selected === day.date && detailKey === item.key ? ' active' : ''}`} onClick={() => openItem(item)}>
                              {item.kind === 'earnings' ? (
                                <>
                                  <span className="calendar-agenda-time">TBC</span>
                                  <span className="calendar-panel-icon" aria-hidden="true">📈</span>
                                  <span className="calendar-panel-text">
                                    <span>{item.earnings.symbol} earnings call</span>
                                    <span className="muted small">
                                      {[quarterLabel(item.earnings), item.earnings.nzDateKnown ? 'Time to be confirmed' : 'US date · NZ time to be confirmed'].filter(Boolean).join(' · ')}
                                    </span>
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="calendar-agenda-time">{timeSpan(item.meeting).split('–')[0]}</span>
                                  <span
                                    className={`calendar-panel-icon${item.meeting.businessId ? ` calendar-biz-dot calendar-biz-${businessColourSlot(item.meeting.businessId)}` : ''}`}
                                    aria-hidden="true"
                                  >
                                    {item.meeting.businessId ? '●' : '◆'}
                                  </span>
                                  <span className="calendar-panel-text">
                                    <span>
                                      {item.meeting.title}
                                      {item.meeting.status !== 'scheduled' ? <span className="muted small"> · {item.meeting.status === 'done' ? 'Done' : 'Cancelled'}</span> : null}
                                    </span>
                                    <span className="muted small">
                                      {[timeSpan(item.meeting), item.meeting.clientName, item.meeting.businessId ? item.meeting.businessName : item.meeting.kind === 'event' ? 'Event' : 'Personal']
                                        .filter(Boolean)
                                        .join(' · ')}
                                    </span>
                                  </span>
                                </>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted small">Public holiday.</p>
                    )}
                  </section>
                ))
              )}
            </section>
          )}

          <DayPanel
            date={selected}
            today={today}
            holiday={holidays.get(selected) ?? null}
            items={dayItems}
            detail={detail}
            holdingFor={holdingFor}
            onOpen={openItem}
            onBack={() => setDetailKey(null)}
            onAdd={openNew}
            onEditPersonal={editPersonal}
          />
        </div>
      ) : null}

      {editing ? (
        <MeetingForm
          key={`${editing.meeting?.id ?? 'new'}-${editing.n}`}
          meeting={editing.meeting}
          initial={editing.initial}
          business={null}
          clients={[]}
          onSave={save}
          onStatus={setStatus}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
