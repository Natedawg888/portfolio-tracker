/**
 * Add or edit a business (KAN-84): name, type, industry, NZBN, GST, business email (also the
 * Reply-To on its invoices), the details printed on invoices, and what it counts towards.
 * The server checks everything again.
 */
import { useState } from 'react';
import { BUSINESS_TYPES } from '../../lib/business';
import type { Business, BusinessWriteBody } from '../../types';
import { Dialog, FormActions, errorText } from './BusinessUi';

export function blankBusiness(): BusinessWriteBody {
  return {
    name: '',
    type: 'sole_trader',
    industry: '',
    nzbn: '',
    gstRegistered: false,
    gstNumber: '',
    email: '',
    address: '',
    phone: '',
    bankAccount: '',
    invoicePrefix: 'INV-',
    clientsEnabled: true,
    countInNetWorth: true,
  };
}

export function businessBody(b: Business): BusinessWriteBody {
  return {
    name: b.name,
    type: b.type,
    industry: b.industry,
    nzbn: b.nzbn,
    gstRegistered: b.gstRegistered,
    gstNumber: b.gstNumber,
    email: b.email,
    address: b.address,
    phone: b.phone,
    bankAccount: b.bankAccount,
    invoicePrefix: b.invoicePrefix,
    clientsEnabled: b.clientsEnabled,
    countInNetWorth: b.countInNetWorth,
  };
}

function blocker(d: BusinessWriteBody): string | null {
  if (!d.name.trim()) return 'Add a name';
  if (d.nzbn.trim() && !/^\d{13}$/.test(d.nzbn.replace(/\s/g, ''))) return 'NZBN is 13 digits';
  if (d.gstRegistered && !/^\d{2,3}-?\d{3}-?\d{3}$/.test(d.gstNumber.trim())) return 'Add the GST number (8 or 9 digits)';
  if (/\d$/.test(d.invoicePrefix.trim())) return 'Invoice prefix can’t end in a digit';
  return null;
}

export function BusinessForm({ title, initial, onSave, onClose }: {
  title: string;
  initial: BusinessWriteBody;
  onSave: (body: BusinessWriteBody) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof BusinessWriteBody>(k: K, v: BusinessWriteBody[K]) => setD((prev) => ({ ...prev, [k]: v }));

  async function save() {
    if (blocker(d)) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...d, name: d.name.trim(), nzbn: d.nzbn.replace(/\s/g, ''), gstNumber: d.gstNumber.trim() });
    } catch (e) {
      setError(errorText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label className="span-2">
          Name
          <input value={d.name} maxLength={120} placeholder="e.g. Kōwhai Honey" autoFocus onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          Type
          <select value={d.type} onChange={(e) => set('type', e.target.value as BusinessWriteBody['type'])}>
            {BUSINESS_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Industry (optional)
          <input value={d.industry} maxLength={80} placeholder="e.g. Beekeeping" onChange={(e) => set('industry', e.target.value)} />
        </label>
        <label>
          NZBN (optional)
          <input value={d.nzbn} inputMode="numeric" maxLength={16} onChange={(e) => set('nzbn', e.target.value)} />
        </label>
        <label>
          Business email (optional)
          <input type="email" value={d.email} maxLength={254} onChange={(e) => set('email', e.target.value)} />
          <span className="muted small">Printed on invoices, and replies to invoice emails go here.</span>
        </label>
        <label className="span-2 rental-money-toggle">
          <span>
            <input type="checkbox" checked={d.gstRegistered} onChange={(e) => set('gstRegistered', e.target.checked)} />
            GST registered
          </span>
        </label>
        {d.gstRegistered ? (
          <label>
            GST number
            <input value={d.gstNumber} inputMode="numeric" maxLength={20} placeholder="123-456-789" onChange={(e) => set('gstNumber', e.target.value)} />
          </label>
        ) : null}
        <details className="span-2 invoice-more">
          <summary>Printed on invoices</summary>
          <div className="form-grid">
            <label className="span-2">
              Address
              <textarea value={d.address} maxLength={400} rows={2} onChange={(e) => set('address', e.target.value)} />
            </label>
            <label>
              Phone
              <input value={d.phone} maxLength={40} onChange={(e) => set('phone', e.target.value)} />
            </label>
            <label>
              Bank account for payments
              <input value={d.bankAccount} maxLength={40} placeholder="12-3456-7890123-00" onChange={(e) => set('bankAccount', e.target.value)} />
            </label>
            <label>
              Invoice number prefix
              <input value={d.invoicePrefix} maxLength={12} onChange={(e) => set('invoicePrefix', e.target.value)} />
            </label>
          </div>
        </details>
        <label className="span-2 rental-money-toggle">
          <span>
            <input type="checkbox" checked={d.clientsEnabled} onChange={(e) => set('clientsEnabled', e.target.checked)} />
            Keep a client list for this business
          </span>
        </label>
        <label className="span-2 rental-money-toggle">
          <span>
            <input type="checkbox" checked={d.countInNetWorth} onChange={(e) => set('countInNetWorth', e.target.checked)} />
            Count its assets in net worth and projections
          </span>
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={blocker(d)} saveLabel="Save business" onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}
