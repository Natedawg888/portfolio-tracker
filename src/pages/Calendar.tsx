/**
 * Calendar: client meetings from the user's businesses, as a month grid or an agenda list, in NZ
 * time. ?new=1&business=&client= opens the add form (the client card links here). Earnings and
 * dividend dates for holdings join this page later.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { errorText } from '../components/business/BusinessUi';
import { MeetingForm } from '../components/calendar/MeetingForm';
import { agenda, byDate, dayLabel, gridRange, meetingBody, monthGrid, monthLabel, newMeetingBody, shiftMonth, timeSpan, videoLink } from '../lib/calendarView';
import { utcToLocal } from '../lib/nzTime';
import type { BusinessCard, BusinessMeeting, InvoiceClient, MeetingStatus, MeetingWriteBody } from '../types';

type Editing = { meeting: BusinessMeeting | null; initial: MeetingWriteBody; n: number };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function MeetingChip({ m, onOpen }: { m: BusinessMeeting; onOpen: (m: BusinessMeeting) => void }) {
  return (
    <button type="button" className={`calendar-chip calendar-chip--${m.status}`} onClick={() => onOpen(m)} title={`${timeSpan(m)} ${m.title}`}>
      <span className="calendar-chip-time">{timeSpan(m).split('–')[0]}</span> {m.title}
    </button>
  );
}

export function Calendar() {
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => utcToLocal(Date.now()).date);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const [businessFilter, setBusinessFilter] = useState('');
  const [businesses, setBusinesses] = useState<BusinessCard[] | null>(null);
  const [clients, setClients] = useState<InvoiceClient[]>([]);
  const [meetings, setMeetings] = useState<BusinessMeeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reload, setReload] = useState(0);

  // The client card's "+ Meeting" link arrives as ?new=1&business=&client=; read once on load.
  const [wanted] = useState(() => (params.get('new') === '1' ? { businessId: params.get('business'), clientId: params.get('client') } : null));
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.business.list(), api.invoices.clients()])
      .then(([l, c]) => {
        if (cancelled) return;
        setBusinesses(l.businesses);
        setClients(c);
        const fallback = l.businesses.find((b) => b.isDefault)?.id ?? l.businesses[0]?.id ?? '';
        if (wanted && fallback) {
          setEditing({ meeting: null, initial: newMeetingBody({ businessId: wanted.businessId || fallback, clientId: wanted.clientId, date: today }), n: 0 });
          setParams({}, { replace: true });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e, 'Could not load your businesses.'));
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, today, setParams]);

  const range = useMemo(() => gridRange(month), [month]);
  useEffect(() => {
    let cancelled = false;
    api.calendar
      .range(range.from, range.to, businessFilter || null)
      .then((r) => {
        if (!cancelled) setMeetings(r.meetings);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e, 'Could not load the calendar.'));
      });
    return () => {
      cancelled = true;
    };
  }, [range, businessFilter, reload]);

  const defaultBusiness = businessFilter || businesses?.find((b) => b.isDefault)?.id || businesses?.[0]?.id || '';
  const openNew = (o: { date?: string; businessId?: string; clientId?: string | null; title?: string } = {}) =>
    setEditing((prev) => ({
      meeting: null,
      initial: newMeetingBody({ businessId: o.businessId || defaultBusiness, clientId: o.clientId, date: o.date ?? today, title: o.title }),
      n: (prev?.n ?? 0) + 1,
    }));
  const open = (m: BusinessMeeting) => setEditing((prev) => ({ meeting: m, initial: meetingBody(m), n: (prev?.n ?? 0) + 1 }));
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

  const grouped = useMemo(() => byDate(meetings ?? []), [meetings]);
  const list = useMemo(() => agenda((meetings ?? []).filter((m) => m.date.startsWith(month)), `${month}-01`), [meetings, month]);
  const active = businesses ?? [];

  return (
    <div className="stack calendar-page">
      <header className="warranties-header">
        <div>
          <h2 className="page-title">Calendar</h2>
          <p className="muted small">Client meetings across your businesses, in NZ time.</p>
        </div>
        {active.length > 0 ? (
          <div className="warranties-header-actions">
            <button type="button" className="btn small primary" onClick={() => openNew()}>
              + Meeting
            </button>
          </div>
        ) : null}
      </header>

      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {businesses && active.length === 0 ? (
        <section className="panel warranties-empty">
          <h3>No business yet</h3>
          <p>
            Meetings belong to a business. <Link to="/business">Add a business</Link> to start booking client meetings.
          </p>
        </section>
      ) : null}

      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button type="button" className="btn small" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            ‹
          </button>
          <h3 className="calendar-month">{monthLabel(month)}</h3>
          <button type="button" className="btn small" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            ›
          </button>
          {month !== today.slice(0, 7) ? (
            <button type="button" className="btn small" onClick={() => setMonth(today.slice(0, 7))}>
              Today
            </button>
          ) : null}
        </div>
        <div className="calendar-filters">
          {active.length > 1 ? (
            <select aria-label="Business" value={businessFilter} onChange={(e) => setBusinessFilter(e.target.value)}>
              <option value="">All businesses</option>
              {active.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || 'Unnamed business'}
                </option>
              ))}
            </select>
          ) : null}
          <div className="segmented" role="group" aria-label="Calendar view">
            {(['month', 'agenda'] as const).map((v) => (
              <button key={v} type="button" className={`segmented-btn${view === v ? ' active' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === 'month' ? 'Month' : 'Agenda'}
              </button>
            ))}
          </div>
        </div>
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
                  aria-label={`Add a meeting on ${dayLabel(day.date)}`}
                  disabled={active.length === 0}
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
            <p className="muted">No meetings in {monthLabel(month)}.</p>
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
                            businesses && businesses.length > 1 ? m.businessName : '',
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

      {editing && businesses ? (
        <MeetingForm
          key={`${editing.meeting?.id ?? 'new'}-${editing.n}`}
          meeting={editing.meeting}
          initial={editing.initial}
          businesses={active}
          clients={clients}
          onSave={save}
          onStatus={setStatus}
          onFollowUp={(m) => openNew({ businessId: m.businessId, clientId: m.clientId, title: `Follow-up: ${m.title}` })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
