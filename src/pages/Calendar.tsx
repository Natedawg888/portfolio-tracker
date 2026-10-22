/**
 * Calendar: what's coming up, as a month grid or an agenda list, in NZ time. Three layers, each
 * toggled by a filter pill: earnings calls for stocks the user holds, client meetings from their
 * businesses, and their own meetings and events. Client meetings are booked on each business's
 * page (opening one here goes there); this page books personal meetings and events, which need
 * no business.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { errorText } from '../components/business/BusinessUi';
import { MeetingForm } from '../components/calendar/MeetingForm';
import {
  CALENDAR_LAYERS,
  agenda,
  byDate,
  dayLabel,
  gridRange,
  layerCounts,
  meetingBody,
  meetingLayer,
  monthGrid,
  monthLabel,
  newMeetingBody,
  shiftMonth,
  timeSpan,
  toggleLayer,
  videoLink,
  type CalendarLayer,
} from '../lib/calendarView';
import { utcToLocal } from '../lib/nzTime';
import type { BusinessMeeting, MeetingStatus, MeetingWriteBody } from '../types';

type Editing = { meeting: BusinessMeeting | null; initial: MeetingWriteBody; n: number };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ALL_LAYERS = new Set<CalendarLayer>(CALENDAR_LAYERS.map((l) => l.id));

function MeetingChip({ m, onOpen }: { m: BusinessMeeting; onOpen: (m: BusinessMeeting) => void }) {
  const owner = m.businessId ? m.businessName || 'Business' : m.kind === 'event' ? 'Event' : 'Personal';
  return (
    <button
      type="button"
      className={`calendar-chip calendar-chip--${m.status}${m.businessId ? '' : ' calendar-chip--personal'}`}
      onClick={() => onOpen(m)}
      title={`${timeSpan(m)} ${m.title} · ${owner}`}
    >
      <span className="calendar-chip-time">{timeSpan(m).split('–')[0]}</span> {m.title}
    </button>
  );
}

export function Calendar() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => utcToLocal(Date.now()).date);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const [layers, setLayers] = useState<Set<CalendarLayer>>(ALL_LAYERS);
  const [meetings, setMeetings] = useState<BusinessMeeting[] | null>(null);
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

  const range = useMemo(() => gridRange(month), [month]);
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
    return () => {
      cancelled = true;
    };
  }, [range, reload]);

  const openNew = (o: { date?: string } = {}) =>
    setEditing((prev) => ({ meeting: null, initial: newMeetingBody({ businessId: null, date: o.date ?? today }), n: (prev?.n ?? 0) + 1 }));
  // A business meeting is edited on its business's page; personal entries open here.
  const open = (m: BusinessMeeting) => {
    if (m.businessId) navigate(`/business/${encodeURIComponent(m.businessId)}?meeting=${encodeURIComponent(m.id)}`);
    else setEditing((prev) => ({ meeting: m, initial: meetingBody(m), n: (prev?.n ?? 0) + 1 }));
  };
  const done = () => {
    setEditing(null);
    setReload((n) => n + 1);
  };

  async function save(body: MeetingWriteBody) {
    if (editing?.meeting) await api.calendar.updateMeeting(editing.meeting.id, body);
    else await api.calendar.createMeeting(body);
    setMonth(body.date.slice(0, 7));
    done();
  }

  async function setStatus(status: MeetingStatus) {
    if (!editing?.meeting) return;
    await api.calendar.setStatus(editing.meeting.id, status);
    done();
  }

  const counts = useMemo(() => layerCounts(meetings ?? [], month), [meetings, month]);
  const shown = useMemo(() => (meetings ?? []).filter((m) => layers.has(meetingLayer(m))), [meetings, layers]);
  const grouped = useMemo(() => byDate(shown), [shown]);
  const list = useMemo(() => agenda(shown.filter((m) => m.date.startsWith(month)), `${month}-01`), [shown, month]);

  return (
    <div className="stack bills-page warranties-page rentals-page calendar-page">
      <header className="warranties-header">
        <div>
          <h2 className="page-title">Calendar</h2>
          <p className="muted small">Earnings calls for stocks you hold, client meetings from your businesses, and your own meetings and events · NZ time</p>
        </div>
        <div className="warranties-header-actions">
          <button type="button" className="btn small primary" onClick={() => openNew()}>
            + Meeting or event
          </button>
        </div>
      </header>

      {error ? <p className="auth-error" role="alert">{error}</p> : null}

      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button type="button" className="btn calendar-today" disabled={month === today.slice(0, 7)} onClick={() => setMonth(today.slice(0, 7))}>
            Today
          </button>
          <button type="button" className="btn calendar-step" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            ‹
          </button>
          <h3 className="calendar-month" aria-live="polite">
            {monthLabel(month)}
          </h3>
          <button type="button" className="btn calendar-step" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            ›
          </button>
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
                  <span className="sr-only"> in {monthLabel(month)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <Link className="calendar-book-link" to="/business">
          Book meetings on the Business page ›
        </Link>
      </div>

      {meetings == null && !error ? <p className="muted">Loading…</p> : null}

      {meetings && view === 'month' ? (
        <section className="panel calendar-grid" aria-label={monthLabel(month)}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="calendar-weekday muted small">
              {d}
            </div>
          ))}
          {monthGrid(month).flat().map((day) => {
            const items = grouped.get(day.date) ?? [];
            return (
              <div
                key={day.date}
                className={`calendar-day${day.inMonth ? '' : ' calendar-day--other'}${day.date === today ? ' calendar-day--today' : ''}`}
              >
                <button
                  type="button"
                  className="calendar-day-num"
                  aria-label={`Add a meeting or event on ${dayLabel(day.date)}`}
                  onClick={() => openNew({ date: day.date })}
                >
                  {Number(day.date.slice(8))}
                </button>
                {items.map((m) => (
                  <MeetingChip key={m.id} m={m} onOpen={open} />
                ))}
              </div>
            );
          })}
        </section>
      ) : null}

      {meetings && view === 'agenda' ? (
        list.length === 0 ? (
          <section className="panel warranties-empty">
            <p className="muted">Nothing in {monthLabel(month)}.</p>
          </section>
        ) : (
          list.map((day) => (
            <section key={day.date} className="panel warranty-card" aria-label={dayLabel(day.date)}>
              <h3>
                {dayLabel(day.date)}
                {day.date === today ? <span className="muted small"> · Today</span> : null}
              </h3>
              <ul className="rental-entries">
                {day.meetings.map((m) => {
                  const link = videoLink(m.location);
                  return (
                    <li key={m.id} className={`rental-entry calendar-agenda-item calendar-agenda-item--${m.status}`}>
                      <div className="rental-entry-what">
                        <span>
                          <button type="button" className="calendar-link-button" onClick={() => open(m)}>
                            {m.title}
                          </button>
                          {m.status !== 'scheduled' ? <span className="muted small"> · {m.status === 'done' ? 'Done' : 'Cancelled'}</span> : null}
                        </span>
                        <span className="muted small">
                          {[
                            timeSpan(m),
                            m.clientName,
                            m.businessId ? m.businessName : m.kind === 'event' ? 'Event' : 'Personal',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          {link ? (
                            <>
                              {' · '}
                              <a href={link} target="_blank" rel="noreferrer noopener">
                                Join call
                              </a>
                            </>
                          ) : m.location ? (
                            ` · ${m.location}`
                          ) : null}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )
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
