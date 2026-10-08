/**
 * Settings → Business (KAN-71): the details printed on every invoice.
 * Saved once and pre-filled on each invoice; a sent invoice keeps the copy it was sent with.
 */
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { BusinessProfile } from '../types';

export function BusinessDetailsPanel() {
  const [form, setForm] = useState<BusinessProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.invoices
      .business()
      .then((p) => {
        if (!cancelled) setForm(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load business details.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!form) {
    return (
      <section className="panel">
        <h2>Business</h2>
        {error ? <p className="auth-error" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </section>
    );
  }

  const set = <K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) => {
    setForm({ ...form, [key]: value });
    setMsg(null);
  };

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      setForm(await api.invoices.saveBusiness(form));
      setMsg('Saved. New and draft invoices use these details.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Business</h2>
      <p className="page-lead">
        Printed on your invoices. Invoices you have already sent keep the details they were sent with.
      </p>
      <div className="form-grid">
        <label>
          Your name or business name
          <input value={form.businessName} maxLength={120} onChange={(e) => set('businessName', e.target.value)} />
        </label>
        <label>
          Email
          <input type="email" value={form.email} maxLength={254} onChange={(e) => set('email', e.target.value)} />
          <span className="muted small">Clients reply to this address.</span>
        </label>
        <label className="span-2">
          Address
          <textarea rows={3} value={form.address} maxLength={400} onChange={(e) => set('address', e.target.value)} />
        </label>
        <label>
          Phone
          <input value={form.phone} maxLength={40} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label>
          Bank account for payment
          <input value={form.bankAccount} maxLength={40} placeholder="12-3456-7890123-00" onChange={(e) => set('bankAccount', e.target.value)} />
        </label>
        <label className="field checkbox-field span-2">
          <label className="inline-check">
            <input type="checkbox" checked={form.gstRegistered} onChange={(e) => set('gstRegistered', e.target.checked)} />
            GST registered
          </label>
          <span className="muted small">
            Invoices are titled “Tax invoice” and show your GST number, the GST amount and the total including GST.
          </span>
        </label>
        <label>
          GST number{form.gstRegistered ? '' : ' (optional)'}
          <input value={form.gstNumber} maxLength={20} placeholder="123-456-789" onChange={(e) => set('gstNumber', e.target.value)} />
        </label>
        <label>
          NZBN (optional)
          <input value={form.nzbn} maxLength={20} inputMode="numeric" onChange={(e) => set('nzbn', e.target.value)} />
        </label>
        <label>
          Invoice number prefix
          <input value={form.invoicePrefix} maxLength={12} onChange={(e) => set('invoicePrefix', e.target.value)} />
          <span className="muted small">New invoices are numbered {form.invoicePrefix || 'INV-'}0001, 0002 and so on.</span>
        </label>
      </div>
      <div className="row gap" style={{ marginTop: '0.75rem' }}>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
          Save business details
        </button>
      </div>
      {msg ? <p className="banner" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </section>
  );
}
