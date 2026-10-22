/**
 * Add or edit a client meeting. Times are NZ time. An existing meeting also offers its status
 * changes (done, cancel, reopen), and once it has happened, an invoice or a follow-up for the client.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BusinessCard, BusinessMeeting, InvoiceClient, MeetingStatus, MeetingWriteBody } from '../../types';
import { Dialog, FormActions, errorText } from '../business/BusinessUi';
import { REMINDER_CHOICES, reminderLabel } from '../../lib/calendarView';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

export function MeetingForm({ meeting, initial, businesses, clients, onSave, onStatus, onFollowUp, onClose }: {
  /** The saved meeting when editing; null when adding. */
  meeting: BusinessMeeting | null;
  initial: MeetingWriteBody;
  businesses: BusinessCard[];
  clients: InvoiceClient[];
  onSave: (body: MeetingWriteBody) => Promise<void>;
  onStatus: (status: MeetingStatus) => Promise<void>;
  onFollowUp: (m: BusinessMeeting) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [openedAt] = useState(() => new Date().toISOString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof MeetingWriteBody>(k: K, v: MeetingWriteBody[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const businessClients = clients.filter((c) => c.businessId === d.businessId && (c.status !== 'inactive' || c.id === d.clientId));
  const hint = !d.businessId ? 'Choose a business' : !d.title.trim() ? 'Add a title' : !d.date || !d.time ? 'Pick a date and time' : null;
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
    <Dialog title={meeting ? 'Edit meeting' : 'Add meeting'} onClose={onClose}>
      {meeting && meeting.status !== 'scheduled' ? (
        <p className="muted small">This meeting is {meeting.status === 'done' ? 'marked done' : 'cancelled'}.</p>
      ) : null}
      <div className="form-grid warranty-form">
        {businesses.length > 1 ? (
          <label>
            Business
            <select
              value={d.businessId}
              onChange={(e) => setD((prev) => ({ ...prev, businessId: e.target.value, clientId: null }))}
            >
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || 'Unnamed business'}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
        <label className="span-2">
          Title
          <input value={d.title} maxLength={120} autoFocus onChange={(e) => set('title', e.target.value)} />
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
      <FormActions busy={busy} hint={hint} saveLabel={meeting ? 'Save meeting' : 'Add meeting'} onSave={() => void run(() => onSave(d))} onClose={onClose} />
      {meeting ? (
        <div className="row gap meeting-actions">
          {meeting.status === 'scheduled' ? (
            <>
              <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => onStatus('done'))}>
                Mark done
              </button>
              <button type="button" className="btn small danger" disabled={busy} onClick={() => void run(() => onStatus('cancelled'))}>
                Cancel meeting
              </button>
            </>
          ) : (
            <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => onStatus('scheduled'))}>
              Reopen
            </button>
          )}
          {happened && meeting.status !== 'cancelled' && meeting.clientId ? (
            <>
              <Link
                className="btn small primary"
                to={`/business/invoices/new?business=${encodeURIComponent(meeting.businessId)}&client=${encodeURIComponent(meeting.clientId)}`}
              >
                Create invoice
              </Link>
              <button type="button" className="btn small" disabled={busy} onClick={() => onFollowUp(meeting)}>
                Book follow-up
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
