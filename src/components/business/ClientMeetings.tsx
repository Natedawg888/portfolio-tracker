/**
 * "Client meetings" on a business's page: where its meetings are booked and managed. Each one
 * shows on the Calendar (with its in-app reminders). "+ Meeting" opens an inline form: client
 * (this business's clients as one-tap suggestions; a new name is saved as a client), date, start
 * time, place or video link, and length as buttons, with a summary line that notes a public
 * holiday or an earnings call for a holding on that date. Booked meetings are listed soonest
 * first, with Create invoice and a ⋯ menu (Edit, Cancel meeting). Past ones sit behind a toggle.
 *
 * Deep links: ?meeting=new (&client=) opens the form; ?meeting=<id> opens that meeting to edit.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { MEETING_LENGTHS, durationLabel, meetingSummary, shortDayLabel, timeSpan, videoLink } from '../../lib/calendarView';
import { addDays, utcToLocal } from '../../lib/nzTime';
import { showQuietToast } from '../../lib/quietToast';
import type { BusinessMeeting, InvoiceClient } from '../../types';
import { MoreMenu } from '../MoreMenu';
import { errorText } from './BusinessUi';

const DEFAULT_REMINDERS = [1440, 60];
/** Suggestions shown under the client field. */
const MAX_SUGGESTIONS = 6;

type Draft = { client: string; date: string; time: string; location: string; durationMinutes: number };

function newDraft(clients: InvoiceClient[], today: string, clientId: string | null = null): Draft {
  return { client: clientId ? (clients.find((c) => c.id === clientId)?.name ?? '') : '', date: today, time: '10:00', location: '', durationMinutes: 60 };
}

function editDraft(m: BusinessMeeting): Draft {
  return { client: m.clientName, date: m.date, time: m.time, location: m.location, durationMinutes: m.durationMinutes };
}

const isAutoTitle = (title: string) => title === 'Client meeting' || title.startsWith('Meeting with ');
const titleFor = (client: string) => (client.trim() ? `Meeting with ${client.trim()}` : 'Client meeting');

function MeetingForm({ businessId, meeting, initial, clients, onSaved, onCancel }: {
  businessId: string;
  /** The meeting being edited; null when booking a new one. */
  meeting: BusinessMeeting | null;
  initial: Draft;
  clients: InvoiceClient[];
  onSaved: (note: string, newClient: boolean) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dayNotes, setDayNotes] = useState<string[]>([]);
  const headingId = useId();
  const clientRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const active = clients.filter((c) => c.status !== 'inactive');
  const typed = d.client.trim().toLowerCase();
  const match = active.find((c) => c.name.trim().toLowerCase() === typed) ?? clients.find((c) => c.name.trim().toLowerCase() === typed) ?? null;
  const suggestions = (typed ? active.filter((c) => c.name.toLowerCase().includes(typed) && c !== match) : active).slice(0, MAX_SUGGESTIONS);
  const lengths = [...new Set([...MEETING_LENGTHS, d.durationMinutes])].sort((a, b) => a - b);
  const hint = !d.date ? 'Pick a date' : !/^\d{2}:\d{2}$/.test(d.time) ? 'Pick a start time' : null;

  useEffect(() => clientRef.current?.focus(), []);

  // Note a public holiday or a holding's earnings call on the chosen day (only what the sources give).
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return;
    let cancelled = false;
    Promise.all([api.calendar.holidays(d.date, d.date).catch(() => null), api.calendar.earnings(d.date, d.date).catch(() => null)]).then(([h, e]) => {
      if (cancelled) return;
      const notes = [
        ...(h?.holidays ?? []).map((x) => `${x.name} is a public holiday.`),
        ...(e?.events ?? []).map((x) => `${x.symbol} earnings call that day${x.nzDateKnown ? '' : ' (US date)'}.`),
      ];
      setDayNotes(notes);
    });
    return () => {
      cancelled = true;
    };
  }, [d.date]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (hint) return;
    setBusy(true);
    setError(null);
    try {
      let clientId: string | null = match?.id ?? null;
      let newClient = false;
      const name = d.client.trim();
      if (name && !match) {
        clientId = (await api.invoices.createClient({ businessId, name, email: '', address: '', reference: '' })).id;
        newClient = true;
      }
      const clientName = match?.name ?? name;
      const title = meeting && !isAutoTitle(meeting.title) ? meeting.title : titleFor(clientName);
      const body = {
        businessId,
        clientId,
        kind: 'meeting' as const,
        title,
        date: d.date,
        time: d.time,
        durationMinutes: d.durationMinutes,
        location: d.location.trim(),
        notes: meeting?.notes ?? '',
        reminderOffsets: meeting?.reminderOffsets ?? DEFAULT_REMINDERS,
      };
      if (meeting) await api.calendar.updateMeeting(meeting.id, body);
      else await api.calendar.createMeeting(body);
      const when = meetingSummary(d.date, d.time, d.durationMinutes);
      onSaved(`${meeting ? 'Meeting moved to' : 'Meeting booked:'} ${when}${newClient ? `. ${name} added as a client` : ''}. It’s on your Calendar.`, newClient);
    } catch (err) {
      setError(errorText(err, 'Could not save the meeting.'));
      setBusy(false);
    }
  }

  return (
    <form className="client-meeting-form" aria-labelledby={headingId} onSubmit={(e) => void submit(e)}>
      <h4 id={headingId}>{meeting ? 'Edit meeting' : 'Book a meeting'}</h4>
      <div className="form-grid warranty-form">
        <label className="span-2">
          Client
          <input ref={clientRef} value={d.client} maxLength={120} autoComplete="off" placeholder="Pick one below or type a new name" onChange={(e) => set('client', e.target.value)} />
          {d.client.trim() && !match ? <span className="muted small">New: saved as a client of this business when you book.</span> : null}
        </label>
        {suggestions.length ? (
          <div className="span-2 client-meeting-suggestions" role="group" aria-label="Your clients">
            {suggestions.map((c) => (
              <button key={c.id} type="button" className="btn small ghost" onClick={() => set('client', c.name)}>
                {c.name}
              </button>
            ))}
          </div>
        ) : null}
        <label>
          Date
          <input type="date" value={d.date} required onChange={(e) => set('date', e.target.value)} />
        </label>
        <label>
          Start time (NZ)
          <input type="time" value={d.time} step={300} required onChange={(e) => set('time', e.target.value)} />
        </label>
        <fieldset className="span-2 client-meeting-lengths">
          <legend>Length</legend>
          <div className="segmented" role="group" aria-label="Length">
            {lengths.map((n) => (
              <button key={n} type="button" className={`segmented-btn${d.durationMinutes === n ? ' active' : ''}`} aria-pressed={d.durationMinutes === n} onClick={() => set('durationMinutes', n)}>
                {durationLabel(n)}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="span-2">
          Place or video link (optional)
          <input value={d.location} maxLength={500} placeholder="Address, or https://…" onChange={(e) => set('location', e.target.value)} />
        </label>
      </div>
      {!hint ? (
        <p className="client-meeting-summary" aria-live="polite">
          <strong>{meetingSummary(d.date, d.time, d.durationMinutes)}</strong>
          {match || d.client.trim() ? ` · ${match?.name ?? d.client.trim()}` : ''}
          {dayNotes.map((n) => (
            <span key={n} className="client-meeting-daynote">
              {' '}
              {n}
            </span>
          ))}
        </p>
      ) : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap client-meeting-form-actions">
        <button type="submit" className="btn primary" disabled={busy || hint != null}>
          {busy ? 'Saving…' : meeting ? 'Save meeting' : 'Book meeting'}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {hint ? <span className="muted small">{hint}</span> : null}
      </div>
    </form>
  );
}

export function ClientMeetings({ businessId, businessName, archived, clients, onClientsChanged }: {
  businessId: string;
  businessName: string;
  archived: boolean;
  clients: InvoiceClient[];
  /** A new client was saved from the form; the page reloads its client list. */
  onClientsChanged: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => utcToLocal(Date.now()).date);
  const [meetings, setMeetings] = useState<BusinessMeeting[] | null>(null);
  /** When the list was loaded: what counts as past. */
  const [loadedAt, setLoadedAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ meeting: BusinessMeeting | null; initial: Draft; n: number } | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const wanted = params.get('meeting');
  const name = businessName || 'this business';

  useEffect(() => {
    let cancelled = false;
    // The API caps a range at 400 days: one request for the past year, one for the year ahead.
    Promise.all([api.calendar.range(addDays(today, -365), addDays(today, -1), businessId), api.calendar.range(today, addDays(today, 365), businessId)])
      .then(([past, ahead]) => {
        if (cancelled) return;
        setMeetings([...past.meetings, ...ahead.meetings]);
        setLoadedAt(new Date().toISOString());
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load meetings.');
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, today, reload]);

  const openForm = (meeting: BusinessMeeting | null, initial: Draft) => setForm((prev) => ({ meeting, initial, n: (prev?.n ?? 0) + 1 }));

  // Links from the client card (?meeting=new&client=) and the Calendar (?meeting=<id>).
  useEffect(() => {
    if (!wanted || meetings == null) return;
    const clear = () => {
      const next = new URLSearchParams(params);
      next.delete('meeting');
      next.delete('client');
      setParams(next, { replace: true });
    };
    if (wanted === 'new') {
      if (!archived) setForm((prev) => ({ meeting: null, initial: newDraft(clients, today, params.get('client')), n: (prev?.n ?? 0) + 1 }));
    } else {
      const m = meetings.find((x) => x.id === wanted);
      if (m) {
        if (m.startsAt < loadedAt) setShowPast(true);
        if (!archived) setForm((prev) => ({ meeting: m, initial: editDraft(m), n: (prev?.n ?? 0) + 1 }));
      } else setError('That meeting could not be found.');
    }
    clear();
    sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    // Runs once per link: clear() removes ?meeting, so `wanted` goes null straight after.
  }, [wanted, meetings, loadedAt, params, setParams, archived, clients, today]);

  const upcoming = (meetings ?? []).filter((m) => m.startsAt >= loadedAt && m.status !== 'done');
  const past = (meetings ?? []).filter((m) => m.startsAt < loadedAt || m.status === 'done').reverse();

  async function setStatus(m: BusinessMeeting, status: 'cancelled' | 'scheduled') {
    if (status === 'cancelled' && !window.confirm(`Cancel the meeting on ${meetingSummary(m.date, m.time, m.durationMinutes)}${m.clientName ? ` with ${m.clientName}` : ''}? It stays on record as cancelled.`)) return;
    setBusy(true);
    try {
      await api.calendar.setStatus(m.id, status);
      showQuietToast(status === 'cancelled' ? 'Meeting cancelled.' : 'Meeting reopened.');
      setReload((n) => n + 1);
    } catch (e) {
      setError(errorText(e, 'Could not change the meeting.'));
    } finally {
      setBusy(false);
    }
  }

  function rows(list: BusinessMeeting[]) {
    return (
      <ul className="client-meeting-list">
        {list.map((m) => {
          const link = videoLink(m.location);
          const cancelled = m.status === 'cancelled';
          return (
            <li key={m.id} className={`client-meeting-row${cancelled ? ' client-meeting-row--cancelled' : ''}`}>
              <div className="client-meeting-when">
                <span className="client-meeting-date">{shortDayLabel(m.date)}</span>
                <span className="muted small">
                  {timeSpan(m)} · {durationLabel(m.durationMinutes)}
                </span>
              </div>
              <div className="client-meeting-what">
                <span>
                  {m.clientName || m.title}
                  {cancelled ? <span className="muted small"> · Cancelled</span> : m.status === 'done' ? <span className="muted small"> · Done</span> : null}
                </span>
                {m.location ? (
                  <span className="muted small">
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer noopener">
                        Join call ↗
                      </a>
                    ) : (
                      m.location
                    )}
                  </span>
                ) : null}
              </div>
              <div className="client-meeting-actions">
                {m.clientId && !cancelled ? (
                  <Link className="btn small" to={`/business/invoices/new?business=${encodeURIComponent(businessId)}&client=${encodeURIComponent(m.clientId)}`}>
                    Create invoice
                  </Link>
                ) : null}
                {archived ? null : (
                  <MoreMenu label={`More for the meeting on ${shortDayLabel(m.date)}${m.clientName ? ` with ${m.clientName}` : ''}`} menu>
                    {(close) => (
                      <>
                        <button type="button" role="menuitem" className="btn small business-menu-item" onClick={() => { close(); openForm(m, editDraft(m)); }}>
                          Edit
                        </button>
                        {cancelled ? (
                          <button type="button" role="menuitem" className="btn small business-menu-item" disabled={busy} onClick={() => { close(); void setStatus(m, 'scheduled'); }}>
                            Reopen meeting
                          </button>
                        ) : (
                          <button type="button" role="menuitem" className="btn small business-menu-item business-menu-danger" disabled={busy} onClick={() => { close(); void setStatus(m, 'cancelled'); }}>
                            Cancel meeting…
                          </button>
                        )}
                      </>
                    )}
                  </MoreMenu>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section ref={sectionRef} id="client-meetings" className="panel warranty-card client-meetings" aria-labelledby="biz-client-meetings">
      <div className="rental-card-head">
        <div>
          <h3 id="biz-client-meetings">Client meetings</h3>
          <p className="muted small">Meetings you book here show on your Calendar.</p>
        </div>
        <div className="rental-card-actions">
          {archived || form ? null : (
            <button type="button" className="btn small primary client-meeting-add" aria-label={`Book a meeting for ${name}`} onClick={() => openForm(null, newDraft(clients, today))}>
              + Meeting
            </button>
          )}
        </div>
      </div>

      {form ? (
        <MeetingForm
          key={form.n}
          businessId={businessId}
          meeting={form.meeting}
          initial={form.initial}
          clients={clients}
          onCancel={() => setForm(null)}
          onSaved={(note, newClient) => {
            setForm(null);
            showQuietToast(note);
            setReload((n) => n + 1);
            if (newClient) onClientsChanged();
          }}
        />
      ) : null}

      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {meetings == null && !error ? <p className="muted small">Loading…</p> : null}
      {meetings && upcoming.length === 0 && !form ? <p className="muted small">No meetings booked.</p> : null}
      {upcoming.length ? rows(upcoming) : null}

      {past.length ? (
        <>
          <button type="button" className="link-btn client-meeting-past-toggle" aria-expanded={showPast} aria-controls="client-meetings-past" onClick={() => setShowPast((s) => !s)}>
            {showPast ? 'Hide past meetings' : `Past meetings (${past.length})`}
          </button>
          {showPast ? <div id="client-meetings-past">{rows(past)}</div> : null}
        </>
      ) : null}
    </section>
  );
}
