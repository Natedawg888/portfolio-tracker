/**
 * Add or edit a calendar entry. Times are NZ time. With `business`, it's that business's meeting
 * (set up on the business page) with an optional client; without, it's a personal meeting or
 * event (set up on the Calendar page). An existing entry also offers its status changes (done,
 * cancel, reopen), and once a client meeting has happened, an invoice or a follow-up.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BusinessMeeting, InvoiceClient, MeetingKind, MeetingStatus, MeetingWriteBody } from '../../types';
import { Dialog, FormActions, errorText } from '../business/BusinessUi';
import { REMINDER_CHOICES, reminderLabel } from '../../lib/calendarView';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 480, 720, 1440];

function entryWord(kind: MeetingKind): string {
  return kind === 'event' ? 'event' : 'meeting';
}

export function MeetingForm({ meeting, initial, business, clients, onSave, onStatus, onFollowUp, onClose }: {
  /** The saved entry when editing; null when adding. */
  meeting: BusinessMeeting | null;
  initial: MeetingWriteBody;
  /** The business this meeting is for; null for a personal meeting or event. */
  business: { id: string; name: string } | null;
  /** The business's clients (ignored for personal entries). */
  clients: InvoiceClient[];
  onSave: (body: MeetingWriteBody) => Promise<void>;
  onStatus: (status: MeetingStatus) => Promise<void>;
  onFollowUp?: (m: BusinessMeeting) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<MeetingWriteBody>(() =>
    business ? { ...initial, businessId: business.id, kind: 'meeting' } : { ...initial, businessId: null, clientId: null },
  );
  const [openedAt] = useState(() => new Date().toISOString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof MeetingWriteBody>(k: K, v: MeetingWriteBody[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const businessClients = business ? clients.filter((c) => c.businessId === business.id && (c.status !== 'inactive' || c.id === d.clientId)) : [];
  const word = entryWord(d.kind);
  const hint = !d.title.trim() ? 'Add a title' : !d.date || !d.time ? 'Pick a date and time' : null;
  const happened = meeting != null && meeting.startsAt <= openedAt;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  function toggleReminder(off: number) {
    set('reminderOffsets', d.reminderOffsets.includes(off) ? d.reminderOffsets.filter((x) => x !== off) : [...d.reminderOffsets, off].sort((a, b) => b - a));
  }

  return (
    <Dialog title={`${meeting ? 'Edit' : 'Add'} ${word}${business ? ` for ${business.name || 'this business'}` : ''}`} onClose={onClose}>
      {meeting && meeting.status !== 'scheduled' ? (
        <p className="muted small">
          This {word} is {meeting.status === 'done' ? 'marked done' : 'cancelled'}.
        </p>
      ) : null}
      <div className="form-grid warranty-form">
        {business ? (
          <label>
            Client (optional)
            <select value={d.clientId ?? ''} onChange={(e) => set('clientId', e.target.value || null)}>
              <option value="">No client</option>
              {businessClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <fieldset className="meeting-kind">
            <legend>Type</legend>
            <div className="segmented" role="group" aria-label="Type">
              {(['meeting', 'event'] as const).map((k) => (
                <button key={k} type="button" className={`segmented-btn${d.kind === k ? ' active' : ''}`} aria-pressed={d.kind === k} onClick={() => set('kind', k)}>
                  {k === 'meeting' ? 'Meeting' : 'Event'}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <label className="span-2">
          Title
          <input
            value={d.title}
            maxLength={120}
            autoFocus
            placeholder={business ? 'e.g. Quarterly review' : d.kind === 'event' ? 'e.g. Dentist, Mum’s birthday dinner' : 'e.g. Catch-up with the accountant'}
            onChange={(e) => set('title', e.target.value)}
          />
        </label>
        <label>
          Date
          <input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label>
          Time (NZ)
          <input type="time" value={d.time} step={300} onChange={(e) => set('time', e.target.value)} />
        </label>
        <label>
          Length
          <select value={d.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))}>
            {[...new Set([...DURATIONS, d.durationMinutes])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>
                {n < 60 ? `${n} min` : n % 60 === 0 ? `${n / 60} hr` : `${Math.floor(n / 60)} hr ${n % 60} min`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Place or video link (optional)
          <input value={d.location} maxLength={500} placeholder="Address, or https://…" onChange={(e) => set('location', e.target.value)} />
        </label>
        <fieldset className="span-2 meeting-reminders">
          <legend>Remind me in the app</legend>
          {REMINDER_CHOICES.map((off) => (
            <label key={off} className="meeting-reminder-choice">
              <input type="checkbox" checked={d.reminderOffsets.includes(off)} onChange={() => toggleReminder(off)} />
              {reminderLabel(off)}
            </label>
          ))}
        </fieldset>
        <label className="span-2">
          Notes (optional)
          <textarea value={d.notes} maxLength={2000} rows={3} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel={meeting ? `Save ${word}` : `Add ${word}`} onSave={() => void run(() => onSave(d))} onClose={onClose} />
      {meeting ? (
        <div className="row gap meeting-actions">
          {meeting.status === 'scheduled' ? (
            <>
              <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => onStatus('done'))}>
                Mark done
              </button>
              <button type="button" className="btn small danger" disabled={busy} onClick={() => void run(() => onStatus('cancelled'))}>
                Cancel {word}
              </button>
            </>
          ) : (
            <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => onStatus('scheduled'))}>
              Reopen
            </button>
          )}
          {happened && meeting.status !== 'cancelled' && meeting.businessId && meeting.clientId ? (
            <>
              <Link
                className="btn small primary"
                to={`/business/invoices/new?business=${encodeURIComponent(meeting.businessId)}&client=${encodeURIComponent(meeting.clientId)}`}
              >
                Create invoice
              </Link>
              {onFollowUp ? (
                <button type="button" className="btn small" disabled={busy} onClick={() => onFollowUp(meeting)}>
                  Book follow-up
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
