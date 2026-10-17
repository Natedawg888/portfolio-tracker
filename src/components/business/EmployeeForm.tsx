/**
 * Add or edit an employee: contact details, the bank account they're paid into, pay rate and
 * when they're paid, and their contract (PDF, Word or photo, uploaded after the employee saves).
 * The bank account formats as you type (12-3456-7890123-00). Records only: nothing is paid from
 * here, and no PAYE is worked out.
 */
import { useState } from 'react';
import { checkBankAccount, formatBankAccount } from '../../lib/businessForm';
import { PAY_FREQUENCIES, PAY_UNITS } from '../../lib/employees';
import type { BusinessEmployee, BusinessEmployeeWriteBody } from '../../types';
import { Dialog, FormActions, errorText } from './BusinessUi';

type Draft = Omit<BusinessEmployeeWriteBody, 'payRateNzd'> & { payRate: string };

/** A contract chosen in the form: its data URL and the name it had on the user's device. */
export type ContractFile = { name: string; data: string };

const CONTRACT_ACCEPT =
  'application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/msword,.doc,image/jpeg,image/png,image/webp,image/gif';
const MAX_CONTRACT_BYTES = 8 * 1024 * 1024;

function readContract(file: File): Promise<ContractFile> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_CONTRACT_BYTES) {
      reject(new Error('The contract must be 8 MB or smaller.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let data = typeof reader.result === 'string' ? reader.result : '';
      // Some systems give Word files no type; name it from the extension so the server accepts it.
      if (data.startsWith('data:;base64,') || data.startsWith('data:application/octet-stream;base64,')) {
        const ext = file.name.toLowerCase().split('.').pop();
        const mime = ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : ext === 'doc' ? 'application/msword' : ext === 'pdf' ? 'application/pdf' : '';
        if (mime) data = `data:${mime};base64,${data.slice(data.indexOf(',') + 1)}`;
      }
      resolve({ name: file.name, data });
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export function employeeDraft(e: BusinessEmployee | null): Draft {
  return {
    name: e?.name ?? '',
    role: e?.role ?? '',
    email: e?.email ?? '',
    phone: e?.phone ?? '',
    address: e?.address ?? '',
    bankAccount: e?.bankAccount ?? '',
    payRate: e?.payRateNzd == null ? '' : String(e.payRateNzd),
    payUnit: e?.payUnit ?? 'hour',
    payFrequency: e?.payFrequency ?? 'fortnightly',
    payDate: e?.payDate ?? null,
    startDate: e?.startDate ?? null,
    status: e?.status ?? 'active',
    notes: e?.notes ?? '',
  };
}

function blocker(d: Draft): string | null {
  if (!d.name.trim()) return 'Add a name';
  if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return 'Check the email';
  if (d.bankAccount.trim() && checkBankAccount(d.bankAccount).tone === 'error') return 'Check the bank account';
  const rate = d.payRate.trim();
  if (rate && (!Number.isFinite(Number(rate)) || Number(rate) < 0)) return 'Pay rate can’t be negative';
  return null;
}

export function EmployeeForm({ title, initial, contract, onSave, onClose }: {
  title: string;
  initial: Draft;
  /** The contract already saved for this employee, if any. */
  contract: BusinessEmployee['contract'];
  /** file: a new contract to upload; removeContract: delete the saved one. */
  onSave: (body: BusinessEmployeeWriteBody, file: ContractFile | null, removeContract: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<ContractFile | null>(null);
  const [removeContract, setRemoveContract] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const hint = blocker(d);
  const bank = d.bankAccount.trim() ? checkBankAccount(d.bankAccount) : null;

  async function save() {
    if (hint) return;
    setBusy(true);
    setError(null);
    try {
      const { payRate, ...rest } = d;
      await onSave({ ...rest, name: d.name.trim(), email: d.email.trim(), payRateNzd: payRate.trim() ? Number(payRate) : null }, file, removeContract);
    } catch (e) {
      setError(errorText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label>
          Name
          <input value={d.name} maxLength={120} autoFocus autoComplete="off" onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          Role (optional)
          <input value={d.role} maxLength={80} placeholder="e.g. Beekeeping hand" onChange={(e) => set('role', e.target.value)} />
        </label>
        <label>
          Email (optional)
          <input type="email" value={d.email} maxLength={254} autoComplete="off" onChange={(e) => set('email', e.target.value)} />
        </label>
        <label>
          Phone (optional)
          <input type="tel" value={d.phone} maxLength={40} autoComplete="off" onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label className="span-2">
          Address (optional)
          <textarea value={d.address} maxLength={400} rows={2} onChange={(e) => set('address', e.target.value)} />
        </label>
        <label className="span-2">
          Bank account for pay (optional)
          <input
            value={d.bankAccount}
            inputMode="numeric"
            maxLength={19}
            autoComplete="off"
            placeholder="12-3456-7890123-00"
            aria-describedby={bank ? 'employee-bank-check' : undefined}
            aria-invalid={bank?.tone === 'error' || undefined}
            onChange={(e) => set('bankAccount', formatBankAccount(e.target.value))}
          />
          {bank ? (
            <span id="employee-bank-check" className={`muted small${bank.tone === 'error' ? ' employee-field-error' : ''}`}>
              {bank.text}
            </span>
          ) : null}
        </label>
        <label>
          Pay rate (optional)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={d.payRate} onChange={(e) => set('payRate', e.target.value)} />
        </label>
        <label>
          Per
          <select value={d.payUnit} onChange={(e) => set('payUnit', e.target.value as Draft['payUnit'])}>
            {PAY_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label.replace(/^an? /, '')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Paid
          <select value={d.payFrequency} onChange={(e) => set('payFrequency', e.target.value as Draft['payFrequency'])}>
            {PAY_FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Next pay date (optional)
          <input type="date" value={d.payDate ?? ''} onChange={(e) => set('payDate', e.target.value || null)} />
        </label>
        <label>
          Start date (optional)
          <input type="date" value={d.startDate ?? ''} onChange={(e) => set('startDate', e.target.value || null)} />
        </label>
        <label>
          Status
          <select value={d.status} onChange={(e) => set('status', e.target.value === 'inactive' ? 'inactive' : 'active')}>
            <option value="active">Active</option>
            <option value="inactive">No longer works here</option>
          </select>
        </label>
        <label className="span-2">
          Notes (optional)
          <textarea value={d.notes} maxLength={1000} rows={2} onChange={(e) => set('notes', e.target.value)} />
        </label>
        <div className="span-2 employee-contract-field">
          <span className="warranty-field-label">Contract (optional)</span>
          {contract && !removeContract && !file ? (
            <p className="small">
              <a href={contract.url} target="_blank" rel="noreferrer" download={contract.name}>
                {contract.name}
              </a>{' '}
              ·{' '}
              <button type="button" className="link-btn" onClick={() => setRemoveContract(true)}>
                Remove
              </button>
            </p>
          ) : null}
          {contract && removeContract && !file ? (
            <p className="small">
              {contract.name} is removed when you save ·{' '}
              <button type="button" className="link-btn" onClick={() => setRemoveContract(false)}>
                Keep it
              </button>
            </p>
          ) : null}
          {file ? (
            <p className="small">
              {file.name} will be saved when you save ·{' '}
              <button type="button" className="link-btn" onClick={() => setFile(null)}>
                Don’t save it
              </button>
            </p>
          ) : null}
          <input
            type="file"
            accept={CONTRACT_ACCEPT}
            aria-label={contract ? 'Replace the contract' : 'Choose a contract file'}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              readContract(f)
                .then((picked) => {
                  setFile(picked);
                  setRemoveContract(false);
                  setError(null);
                })
                .catch((err: unknown) => setError(errorText(err, 'Could not read that file.')));
            }}
          />
          <span className="muted small">A PDF, Word document or photo, up to 8 MB. Kept private to you.</span>
        </div>
      </div>
      <p className="muted small">
        A record for you. Nothing is paid from here, and PAYE, KiwiSaver and ACC aren’t worked out. The next pay date moves on
        by itself once it passes.
      </p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel="Save employee" onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}
