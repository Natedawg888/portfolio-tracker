/**
 * Meetings on the business page: where a business's meetings are set up. Each one shows on the
 * Calendar. Lists upcoming meetings and the latest past ones. ?meeting=new (with &client=) opens
 * the add form, and ?meeting=<id> opens that meeting; the client card and the Calendar link here.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { dayLabel, meetingBody, newMeetingBody, timeSpan, videoLink } from '../../lib/calendarView';
import { addDays, utcToLocal } from '../../lib/nzTime';
import { showQuietToast } from '../../lib/quietToast';
import type { BusinessMeeting, InvoiceClient, MeetingStatus, MeetingWriteBody } from '../../types';
import { MeetingForm } from '../calendar/MeetingForm';

type Editing = { meeting: BusinessMeeting | null; initial: MeetingWriteBody; n: number };

/** Past meetings shown, newest first. */
const RECENT = 3;

export function BusinessMeetings({ businessId, businessName, archived, clients }: {
  businessId: string;
  businessName: string;
  archived: boolean;
  clients: InvoiceClient[];
}) {
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => utcToLocal(Date.now()).date);
  const [meetings, setMeetings] = useState<BusinessMeeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reload, setReload] = useState(0);
  const wanted = params.get('meeting');
  const name = businessName || 'this business';

  useEffect(() => {
    let cancelled = false;
    // 30 days back and a year ahead keeps one request inside the API's 400-day cap.
    api.calendar
      .range(addDays(today, -30), addDays(today, 365), businessId)
      .then((r) => {
        if (cancelled) return;
        setMeetings(r.meetings);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load meetings.');
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, today, reload]);

  // Links from the client card (?meeting=new&client=) and the Calendar (?meeting=<id>).
  useEffect(() => {
    if (!wanted) return;
    const clearParams = () => {
      const next = new URLSearchParams(params);
      next.delete('meeting');
      next.delete('client');
      setParams(next, { replace: true });
    };
    if (wanted === 'new') {
      if (!archived) setEditing({ meeting: null, initial: newMeetingBody({ businessId, clientId: params.get('client'), date: today }), n: 0 });
      clearParams();
      return;
    }
    let cancelled = false;
    api.calendar
      .getMeeting(wanted)
      .then((m) => {
        if (!cancelled && m.businessId === businessId) setEditing({ meeting: m, initial: meetingBody(m), n: 0 });
      })
      .catch(() => {
        if (!cancelled) setError('That meeting could not be found.');
      })
      .finally(() => {
        if (!cancelled) clearParams();
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, params, setParams, businessId, archived, today]);

  const openNew = (o: { clientId?: string | null; title?: string } = {}) =>
    setEditing((prev) => ({ meeting: null, initial: newMeetingBody({ businessId, clientId: o.clientId, date: today, title: o.title }), n: (prev?.n ?? 0) + 1 }));
  const open = (m: BusinessMeeting) => setEditing((prev) => ({ meeting: m, initial: meetingBody(m), n: (prev?.n ?? 0) + 1 }));
  const done = (note: string) => {
    setEditing(null);
    showQuietToast(note);
    setReload((n) => n + 1);
  };

  async function save(body: MeetingWriteBody) {
    if (editing?.meeting) {
      await api.calendar.updateMeeting(editing.meeting.id, body);
      done('Meeting saved. It’s on your Calendar.');
    } else {
      await api.calendar.createMeeting(body);
      done(`Meeting added for ${dayLabel(body.date)}. It’s on your Calendar.`);
    }
  }

  async function setStatus(status: MeetingStatus) {
    if (!editing?.meeting) return;
    await api.calendar.setStatus(editing.meeting.id, status);
    done(status === 'cancelled' ? 'Meeting cancelled.' : status === 'done' ? 'Marked done.' : 'Meeting reopened.');
  }

  const nowIso = new Date().toISOString();
  const upcoming = (meetings ?? []).filter((m) => m.startsAt >= nowIso && m.status === 'scheduled');
  const recent = (meetings ?? []).filter((m) => m.startsAt < nowIso).slice(-RECENT).reverse();

  function rows(list: BusinessMeeting[]) {
    return (
      <ul className="rental-entries">
        {list.map((m) => {
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
                  {[dayLabel(m.date), timeSpan(m), m.clientName].filter(Boolean).join(' · ')}
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
    );
  }

  return (
    <section className="panel warranty-card business-meetings" aria-labelledby="biz-meetings">
      <div className="rental-card-head">
        <h3 id="biz-meetings">Meetings</h3>
        <div className="rental-card-actions">
          {archived ? null : (
            <button type="button" className="btn small ghost" aria-label={`Add a meeting for ${name}`} onClick={() => openNew()}>
              + Meeting
            </button>
          )}
        </div>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {meetings == null && !error ? <p className="muted small">Loading…</p> : null}
      {meetings && upcoming.length === 0 && recent.length === 0 ? (
        <p className="muted small">No meetings yet. Meetings you add here, with or without a client, show on your Calendar with in-app reminders.</p>
      ) : null}
      {upcoming.length ? (
        <>
          <h4 className="muted small">Coming up</h4>
          {rows(upcoming)}
        </>
      ) : null}
      {recent.length ? (
        <>
          <h4 className="muted small">Recent</h4>
          {rows(recent)}
        </>
      ) : null}
      {meetings && (upcoming.length || recent.length) ? (
        <p className="small">
          <Link to="/calendar">Open the calendar</Link>
        </p>
      ) : null}

      {editing ? (
        <MeetingForm
          key={`${editing.meeting?.id ?? 'new'}-${editing.n}`}
          meeting={editing.meeting}
          initial={editing.initial}
          business={{ id: businessId, name: businessName }}
          clients={clients}
          onSave={save}
          onStatus={setStatus}
          onFollowUp={(m) => openNew({ clientId: m.clientId, title: `Follow-up: ${m.title}` })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
