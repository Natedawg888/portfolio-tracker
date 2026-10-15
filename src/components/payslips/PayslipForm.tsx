/**
 * Add / edit a payslip (KAN-78), as a modal like Warranties. Fields follow a payslip: who paid
 * and when, earnings, deductions, net. A live line says whether the net adds up. The file
 * (photo or PDF) uploads after saving. Nothing is read from the file or guessed.
 */
import { useId, useState, type ReactNode } from 'react';
import { formatNzd } from '../../api/client';
import type { Payslip, PayslipFrequency, PayslipWriteBody, PayslipsView } from '../../types';
import { FREQUENCY_LABEL } from '../../lib/payslipCheck';
import { errText, readFile } from '../warranties/receiptFile';

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => (e.target === e.currentTarget ? onClose() : undefined)}>
      <div className="modal-dialog payslip-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="btn small modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Draft = Record<
  | 'paySourceId' | 'employer' | 'frequency' | 'periodStart' | 'periodEnd' | 'payDate' | 'taxCode' | 'hours' | 'hourlyRate' | 'grossNzd' | 'payeNzd' | 'accNzd'
  | 'kiwiSaverEmployeeNzd' | 'kiwiSaverRatePct' | 'kiwiSaverEmployerNzd' | 'esctNzd' | 'studentLoanNzd' | 'otherDeductionsNzd' | 'allowancesNzd' | 'netNzd' | 'notes',
  string
> & { accInPaye: boolean; addToIncome: boolean };

const str = (n: number | null | undefined) => (n == null || n === 0 ? '' : String(n));
function toDraft(p: Payslip | null, last: Payslip | null): Draft {
  const src = p ?? last;
  return {
    paySourceId: src?.paySourceId ?? '',
    employer: src?.employer ?? '',
    frequency: src?.frequency ?? 'fortnightly',
    periodStart: p?.periodStart ?? '',
    periodEnd: p?.periodEnd ?? '',
    payDate: p?.payDate ?? '',
    taxCode: src?.taxCode ?? 'M',
    hours: str(p?.hours),
    hourlyRate: str(src?.hourlyRate),
    grossNzd: str(p?.grossNzd),
    payeNzd: str(p?.payeNzd),
    accNzd: str(p?.accNzd),
    accInPaye: p ? p.accNzd == null : true,
    kiwiSaverEmployeeNzd: str(p?.kiwiSaverEmployeeNzd),
    kiwiSaverRatePct: str(src?.kiwiSaverRatePct),
    kiwiSaverEmployerNzd: str(p?.kiwiSaverEmployerNzd),
    esctNzd: str(p?.esctNzd),
    studentLoanNzd: str(p?.studentLoanNzd),
    otherDeductionsNzd: str(p?.otherDeductionsNzd),
    allowancesNzd: str(p?.allowancesNzd),
    netNzd: str(p?.netNzd),
    addToIncome: p?.addToIncome ?? true,
    notes: p?.notes ?? '',
  };
}

const n = (s: string) => (s.trim() === '' ? 0 : Number(s));
const opt = (s: string) => (s.trim() === '' ? null : Number(s));

export function PayslipForm({
  view,
  payslip,
  last,
  onClose,
  onSave,
}: {
  view: PayslipsView;
  payslip: Payslip | null;
  last: Payslip | null;
  onClose: () => void;
  onSave: (body: PayslipWriteBody, file: string | null, removeFile: boolean) => Promise<void>;
}) {
  const id = useId();
  const [d, setD] = useState<Draft>(() => toDraft(payslip, last));
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft, v: string | boolean) => setD((prev) => ({ ...prev, [k]: v }));

  const deductions = n(d.payeNzd) + (d.accInPaye ? 0 : n(d.accNzd)) + n(d.kiwiSaverEmployeeNzd) + n(d.studentLoanNzd) + n(d.otherDeductionsNzd);
  const expectedNet = Math.round((n(d.grossNzd) + n(d.allowancesNzd) - deductions) * 100) / 100;
  const netEntered = d.netNzd.trim() !== '';
  const netMatches = netEntered && Math.abs(expectedNet - n(d.netNzd)) < 0.015;
  const blocker = !d.employer.trim() && !d.paySourceId ? 'Enter the employer' : !d.periodStart || !d.periodEnd || !d.payDate ? 'Enter the pay period and pay date' : d.grossNzd.trim() === '' ? 'Enter the gross pay' : !netEntered ? 'Enter the net pay' : null;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await onSave(
        {
          paySourceId: d.paySourceId || null,
          employer: d.employer.trim(),
          frequency: d.frequency as PayslipFrequency,
          periodStart: d.periodStart,
          periodEnd: d.periodEnd,
          payDate: d.payDate,
          taxCode: d.taxCode.trim(),
          hours: opt(d.hours),
          hourlyRate: opt(d.hourlyRate),
          grossNzd: n(d.grossNzd),
          payeNzd: n(d.payeNzd),
          accNzd: d.accInPaye ? null : n(d.accNzd),
          kiwiSaverEmployeeNzd: n(d.kiwiSaverEmployeeNzd),
          kiwiSaverRatePct: opt(d.kiwiSaverRatePct),
          kiwiSaverEmployerNzd: n(d.kiwiSaverEmployerNzd),
          esctNzd: n(d.esctNzd),
          studentLoanNzd: n(d.studentLoanNzd),
          otherDeductionsNzd: n(d.otherDeductionsNzd),
          allowancesNzd: n(d.allowancesNzd),
          netNzd: n(d.netNzd),
          addToIncome: d.addToIncome,
          notes: d.notes.trim(),
        },
        file?.data ?? null,
        removeFile,
      );
    } catch (e) {
      setError(errText(e, 'Could not save the payslip.'));
      setBusy(false);
    }
  }

  const money = (k: keyof Draft, label: string, hint?: string) => (
    <label>
      {label}
      <input type="number" min={0} step="0.01" inputMode="decimal" value={String(d[k])} onChange={(e) => set(k, e.target.value)} aria-describedby={hint ? `${id}-${k}-hint` : undefined} />
      {hint ? <span id={`${id}-${k}-hint`} className="muted small">{hint}</span> : null}
    </label>
  );

  return (
    <Dialog title={payslip ? 'Edit payslip' : 'Add a payslip'} onClose={onClose}>
      <div className="form-grid payslip-form">
        <h4 className="span-2 payslip-form-group">Who paid you, and when</h4>
        {view.paySources.length ? (
          <label>
            Pay source (optional)
            <select value={d.paySourceId} onChange={(e) => set('paySourceId', e.target.value)}>
              <option value="">None</option>
              {view.paySources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Employer
          <input value={d.employer} maxLength={120} placeholder={d.paySourceId ? 'From the pay source' : 'e.g. Acme Ltd'} onChange={(e) => set('employer', e.target.value)} />
        </label>
        <label>
          Paid
          <select value={d.frequency} onChange={(e) => set('frequency', e.target.value)}>
            {(Object.keys(FREQUENCY_LABEL) as PayslipFrequency[]).map((f) => (
              <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>
            ))}
          </select>
        </label>
        <label>
          Tax code
          <input value={d.taxCode} maxLength={12} placeholder="e.g. M or ME SL" autoCapitalize="characters" onChange={(e) => set('taxCode', e.target.value)} />
        </label>
        <label>
          Period from
          <input type="date" value={d.periodStart} onChange={(e) => set('periodStart', e.target.value)} />
        </label>
        <label>
          Period to
          <input type="date" value={d.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} />
        </label>
        <label>
          Pay date
          <input type="date" value={d.payDate} onChange={(e) => set('payDate', e.target.value)} />
        </label>

        <h4 className="span-2 payslip-form-group">Earnings</h4>
        <label>
          Hours (optional)
          <input type="number" min={0} step="0.25" inputMode="decimal" value={d.hours} onChange={(e) => set('hours', e.target.value)} />
        </label>
        <label>
          Hourly rate (optional)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={d.hourlyRate} onChange={(e) => set('hourlyRate', e.target.value)} />
        </label>
        {money('grossNzd', 'Gross pay (taxable)')}
        {money('allowancesNzd', 'Tax-free allowances', 'Paid on top and not taxed, e.g. a tool allowance.')}

        <h4 className="span-2 payslip-form-group">Deductions</h4>
        {money('payeNzd', d.accInPaye ? 'PAYE (including ACC levy)' : 'PAYE')}
        <label className="span-2 payslip-check">
          <input type="checkbox" checked={d.accInPaye} onChange={(e) => set('accInPaye', e.target.checked)} />
          <span>The ACC earners’ levy is included in PAYE on this payslip</span>
        </label>
        {!d.accInPaye ? money('accNzd', 'ACC earners’ levy') : null}
        {money('kiwiSaverEmployeeNzd', 'KiwiSaver (yours)')}
        <label>
          Your KiwiSaver rate % (optional)
          <input type="number" min={0} max={100} step="0.5" inputMode="decimal" value={d.kiwiSaverRatePct} onChange={(e) => set('kiwiSaverRatePct', e.target.value)} />
        </label>
        {money('studentLoanNzd', 'Student loan')}
        {money('otherDeductionsNzd', 'Other deductions', 'e.g. union fees, payroll giving.')}
        {money('kiwiSaverEmployerNzd', 'Employer KiwiSaver', 'Not taken from your pay.')}
        {money('esctNzd', 'ESCT', 'Tax on the employer’s KiwiSaver; not taken from your pay.')}

        <h4 className="span-2 payslip-form-group">Net pay</h4>
        {money('netNzd', 'Net pay (into your bank)')}
        <p className={'span-2 small ' + (netEntered && !netMatches ? 'hh-over' : 'muted')} aria-live="polite">
          {!netEntered ? `From the lines above: ${formatNzd(expectedNet)}.` : netMatches ? 'Adds up.' : `The lines above come to ${formatNzd(expectedNet)}, ${formatNzd(Math.abs(expectedNet - n(d.netNzd)))} ${expectedNet > n(d.netNzd) ? 'more' : 'less'} than the net pay.`}
        </p>
        {!netEntered && n(d.grossNzd) > 0 ? (
          <button type="button" className="link-btn span-2 payslip-use-net" onClick={() => set('netNzd', String(expectedNet))}>
            Use {formatNzd(expectedNet)}
          </button>
        ) : null}

        <label className="span-2 payslip-check">
          <input type="checkbox" checked={view.plan.plus && d.addToIncome} disabled={!view.plan.plus} onChange={(e) => set('addToIncome', e.target.checked)} />
          <span>
            Add net pay to Income and match it to the bank deposit
            {!view.plan.plus ? ' (KoruLedger Plus)' : ''}
          </span>
        </label>

        <div className="span-2 payslip-file">
          <span className="warranty-field-label">Payslip file (optional)</span>
          {payslip?.fileUrl && !removeFile && !file ? (
            <p className="small">
              <a href={payslip.fileUrl} target="_blank" rel="noreferrer">View the saved file</a> ·{' '}
              <button type="button" className="link-btn" onClick={() => setRemoveFile(true)}>Remove</button>
            </p>
          ) : null}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            aria-label="Payslip photo or PDF"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              readFile(f)
                .then((data) => {
                  setFile({ name: f.name, data });
                  setRemoveFile(false);
                })
                .catch((err: unknown) => setError(errText(err, 'Could not read that file.')));
            }}
          />
          <span className="muted small">A photo or PDF, up to 8 MB. Kept private to you. The figures aren’t read from it; enter them above.</span>
        </div>

        <label className="span-2">
          Notes (optional)
          <input value={d.notes} maxLength={500} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn primary" disabled={busy || !!blocker} onClick={() => void save()}>
          {payslip ? 'Save changes' : 'Add payslip'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        {blocker ? <span className="muted small">{blocker}</span> : null}
      </div>
    </Dialog>
  );
}
