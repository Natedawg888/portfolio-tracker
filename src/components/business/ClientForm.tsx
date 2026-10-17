/**
 * Add or edit a client (KAN-84): name, contact person, email, phone, address, notes and
 * status. Client details are the user's own records; they aren't shared with a household.
 */
import { useState } from 'react';
import type { Business, InvoiceClient, InvoiceClientWriteBody } from '../../types';
import { Dialog, FormActions, errorText } from './BusinessUi';

export function clientBody(c: InvoiceClient | null, businessId: string): InvoiceClientWriteBody {
  return {
    businessId: c?.businessId ?? businessId,
    name: c?.name ?? '',
    contactPerson: c?.contactPerson ?? '',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    address: c?.address ?? '',
    reference: c?.reference ?? '',
    notes: c?.notes ?? '',
    status: c?.status ?? 'active',
  };
}

export function ClientForm({ title, initial, businesses, onSave, onClose }: {
  title: string;
  initial: InvoiceClientWriteBody;
  /** Shown as a picker when there is more than one. */
  businesses: Business[];
  onSave: (body: InvoiceClientWriteBody) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof InvoiceClientWriteBody>(k: K, v: InvoiceClientWriteBody[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const hint = !d.name.trim() ? 'Add a name' : d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()) ? 'Check the email' : null;

  async function save() {
    if (hint) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...d, name: d.name.trim(), email: d.email.trim() });
    } catch (e) {
      setError(errorText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="form-grid warranty-form">
        {businesses.length > 1 ? (
          <label className="span-2">
            Business
            <select value={d.businessId ?? ''} onChange={(e) => set('businessId', e.target.value)}>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name || 'Unnamed business'}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="span-2">
          Name
          <input value={d.name} maxLength={120} autoFocus onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          Contact person (optional)
          <input value={d.contactPerson ?? ''} maxLength={120} onChange={(e) => set('contactPerson', e.target.value)} />
        </label>
        <label>
          Email (optional)
          <input type="email" value={d.email} maxLength={254} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label>
          Phone (optional)
          <input value={d.phone ?? ''} maxLength={40} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label>
          Status
          <select value={d.status ?? 'active'} onChange={(e) => set('status', e.target.value === 'inactive' ? 'inactive' : 'active')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="span-2">
          Address (optional)
          <textarea value={d.address} maxLength={400} rows={2} onChange={(e) => set('address', e.target.value)} />
        </label>
        <label>
          Reference on invoices (optional)
          <input value={d.reference} maxLength={80} onChange={(e) => set('reference', e.target.value)} />
        </label>
        <label className="span-2">
          Notes (optional)
          <textarea value={d.notes ?? ''} maxLength={1000} rows={2} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel="Save client" onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}
