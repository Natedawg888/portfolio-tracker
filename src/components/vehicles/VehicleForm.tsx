/**
 * Add / edit a vehicle (KAN-65), as a modal like Warranties and Payslips: what it is, what it's
 * worth (the value you record; nothing is estimated), whether it counts in net worth, an optional
 * loan (entered, or a linked bank loan account), and optional running costs.
 */
import { useState, type ReactNode } from 'react';
import { formatNzd } from '../../api/client';
import type { Vehicle, VehicleCostFrequency, VehicleCostKind, VehicleWriteBody, VehiclesView } from '../../types';
import { COST_FREQUENCIES, COST_KINDS, DISTANCE_LABEL, IRD_CAR_DEPRECIATION, costToOwn, depreciatedValue, type DistanceUnit } from '../../lib/vehicles';

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => (e.target === e.currentTarget ? onClose() : undefined)}>
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-label={title}>
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

const KINDS: { value: VehicleWriteBody['kind']; label: string }[] = [
  { value: 'car', label: 'Car' },
  { value: 'ute', label: 'Ute' },
  { value: 'van', label: 'Van' },
  { value: 'motorbike', label: 'Motorbike or scooter' },
  { value: 'campervan', label: 'Campervan or motorhome' },
  { value: 'truck', label: 'Truck' },
  { value: 'boat', label: 'Boat' },
  { value: 'trailer', label: 'Trailer or caravan' },
  { value: 'other', label: 'Other' },
];

type CostRow = { key: string; kind: VehicleCostKind; amount: string; frequency: VehicleCostFrequency; label: string };
const s = (n: number | null | undefined) => (n == null ? '' : String(n));
const num = (v: string) => (v.trim() === '' ? null : Number(v));

export function VehicleForm({
  view,
  vehicle,
  onClose,
  onSave,
}: {
  view: VehiclesView;
  vehicle: Vehicle | null;
  onClose: () => void;
  onSave: (body: VehicleWriteBody) => Promise<void>;
}) {
  const v = vehicle;
  const [name, setName] = useState(v?.name ?? '');
  const [kind, setKind] = useState<VehicleWriteBody['kind']>(v?.kind ?? 'car');
  const [make, setMake] = useState(v?.make ?? '');
  const [model, setModel] = useState(v?.model ?? '');
  const [year, setYear] = useState(s(v?.year));
  const [plate, setPlate] = useState(v?.plate ?? '');
  const [purchaseDate, setPurchaseDate] = useState(v?.purchaseDate ?? '');
  const [purchasePrice, setPurchasePrice] = useState(s(v?.purchasePriceNzd));
  const [value, setValue] = useState(s(v?.valueNzd));
  const [valuedOn, setValuedOn] = useState(v?.valuedOn ?? '');
  const [count, setCount] = useState(v?.countInNetWorth ?? true);
  const [loanKind, setLoanKind] = useState<VehicleWriteBody['loan']['kind']>(v?.loan.kind ?? 'none');
  const [loanAccount, setLoanAccount] = useState(v?.loan.accountId ?? view.loanAccounts[0]?.id ?? '');
  const [loanBalance, setLoanBalance] = useState(s(v?.loan.balanceNzd));
  const [lender, setLender] = useState(v?.loan.lender ?? '');
  const [rate, setRate] = useState(s(v?.loan.ratePct));
  const [repay, setRepay] = useState(s(v?.loan.repaymentNzd));
  const [repayFreq, setRepayFreq] = useState<VehicleCostFrequency>(v?.loan.repaymentFrequency ?? 'month');
  const [costs, setCosts] = useState<CostRow[]>(() =>
    (v?.runningCosts ?? []).map((c, i) => ({ key: `c${i}`, kind: c.kind, amount: String(c.amountNzd), frequency: c.frequency, label: c.label ?? '' })),
  );
  const [odo, setOdo] = useState(s(v?.odometer.reading));
  const [odoUnit, setOdoUnit] = useState<DistanceUnit>(v?.odometer.unit ?? 'km');
  const [odoOn, setOdoOn] = useState(v?.odometer.readOn ?? '');
  const [odoBought, setOdoBought] = useState(s(v?.odometer.atPurchase));
  const [depPct, setDepPct] = useState(s(v?.depreciationPct));
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(v?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCost = (key: string, patch: Partial<CostRow>) => setCosts((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const preview = costToOwn(
    costs.filter((c) => Number(c.amount) > 0).map((c) => ({ kind: c.kind, amountNzd: Number(c.amount), frequency: c.frequency })),
    loanKind !== 'none' && Number(repay) > 0 ? { amountNzd: Number(repay), frequency: repayFreq } : null,
  );
  const estimate =
    num(depPct) != null && num(purchasePrice) != null && purchaseDate ? depreciatedValue(Number(purchasePrice), purchaseDate, Number(depPct), today) : null;
  const blocker = num(odo) != null && num(odoBought) != null && Number(odoBought) > Number(odo) ? 'The reading when bought is more than the latest' : !name.trim() ? 'Give it a name' : loanKind === 'manual' && loanBalance.trim() === '' ? 'Enter how much is owed' : loanKind === 'account' && !loanAccount ? 'Choose the loan account' : null;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await onSave({
        name: name.trim(),
        kind,
        make: make.trim(),
        model: model.trim(),
        year: num(year),
        plate: plate.trim(),
        purchaseDate: purchaseDate || null,
        purchasePriceNzd: num(purchasePrice),
        valueNzd: num(value),
        valuedOn: valuedOn || null,
        countInNetWorth: count,
        loan: {
          kind: loanKind,
          accountId: loanKind === 'account' ? loanAccount : null,
          balanceNzd: loanKind === 'manual' ? num(loanBalance) : null,
          lender: lender.trim(),
          ratePct: num(rate),
          repaymentNzd: num(repay),
          repaymentFrequency: num(repay) != null ? repayFreq : null,
        },
        odometer: { reading: num(odo), unit: odoUnit, readOn: odoOn || null, atPurchase: num(odoBought) },
        depreciationPct: num(depPct),
        runningCosts: costs
          .filter((c) => c.amount.trim() !== '')
          .map((c) => ({ kind: c.kind, amountNzd: Number(c.amount), frequency: c.frequency, ...(c.label.trim() ? { label: c.label.trim() } : {}) })),
        notes: notes.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the vehicle.');
      setBusy(false);
    }
  }

  return (
    <Dialog title={v ? `Edit ${v.name}` : 'Add a vehicle'} onClose={onClose}>
      <div className="form-grid vehicle-form">
        <h4 className="span-2 payslip-form-group">The vehicle</h4>
        <label className="span-2">
          Name
          <input value={name} maxLength={80} placeholder="e.g. The Corolla" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as VehicleWriteBody['kind'])}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
        <label>
          Plate (optional)
          <input value={plate} maxLength={10} autoCapitalize="characters" onChange={(e) => setPlate(e.target.value)} />
        </label>
        <label>
          Make (optional)
          <input value={make} maxLength={40} placeholder="e.g. Toyota" onChange={(e) => setMake(e.target.value)} />
        </label>
        <label>
          Model (optional)
          <input value={model} maxLength={40} placeholder="e.g. Corolla" onChange={(e) => setModel(e.target.value)} />
        </label>
        <label>
          Year (optional)
          <input type="number" min={1900} max={2100} step={1} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
        </label>

        <h4 className="span-2 payslip-form-group">What it’s worth</h4>
        <label>
          Bought on (optional)
          <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
        </label>
        <label>
          Price paid (optional)
          <input type="number" min={0} step="1" inputMode="decimal" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
        </label>
        <label>
          Value now (NZD)
          <input type="number" min={0} step="1" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby="vehicle-value-hint" />
          <span id="vehicle-value-hint" className="muted small">What you’d sell it for. Check a listing site and update it now and then.</span>
        </label>
        <label>
          Valued on
          <input type="date" value={valuedOn} onChange={(e) => setValuedOn(e.target.value)} />
        </label>
        <label>
          Depreciation (% a year, optional)
          <input type="number" min={0} max={99} step="0.5" inputMode="decimal" value={depPct} onChange={(e) => setDepPct(e.target.value)} />
          {kind !== 'boat' && kind !== 'trailer' && depPct !== String(IRD_CAR_DEPRECIATION.ratePct) ? (
            <button type="button" className="link-btn vehicle-ird-rate" onClick={() => setDepPct(String(IRD_CAR_DEPRECIATION.ratePct))}>
              Use IRD’s rate for cars ({IRD_CAR_DEPRECIATION.ratePct}%)
            </button>
          ) : null}
        </label>
        {estimate ? (
          <div className="span-2 vehicle-estimate" aria-live="polite">
            <p className="small">
              Estimated value now: <strong className="money">{formatNzd(estimate.valueNzd)}</strong> ({depPct}% a year from {formatNzd(Number(purchasePrice))} over {estimate.years} years).
            </p>
            <button type="button" className="btn small ghost" onClick={() => { setValue(String(Math.round(estimate.valueNzd))); setValuedOn(today); }}>
              Use as value now
            </button>
            <p className="muted small">
              An estimate only. {IRD_CAR_DEPRECIATION.ratePct}% is IRD’s tax depreciation rate for cars (
              <a href={IRD_CAR_DEPRECIATION.url} target="_blank" rel="noreferrer">s EE 25D</a>), not what it would sell for; a listing site gives a better idea.
            </p>
          </div>
        ) : depPct.trim() !== '' ? (
          <p className="span-2 muted small">Add the date bought and the price paid to see an estimate.</p>
        ) : null}
        <label className="span-2 payslip-check">
          <input type="checkbox" checked={count} onChange={(e) => setCount(e.target.checked)} />
          <span>Count it in my net worth</span>
        </label>

        <h4 className="span-2 payslip-form-group">Odometer (optional)</h4>
        <label>
          Reading
          <input type="number" min={0} step="1" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} />
        </label>
        <label>
          Unit
          <select value={odoUnit} onChange={(e) => setOdoUnit(e.target.value as DistanceUnit)}>
            <option value="km">Kilometres</option>
            <option value="mi">Miles</option>
          </select>
        </label>
        <label>
          Read on
          <input type="date" value={odoOn} onChange={(e) => setOdoOn(e.target.value)} />
        </label>
        <label>
          Reading when bought
          <input type="number" min={0} step="1" inputMode="numeric" value={odoBought} onChange={(e) => setOdoBought(e.target.value)} />
          <span className="muted small">With the date bought, shows {DISTANCE_LABEL[odoUnit]} a year and cost per {odoUnit === 'km' ? 'km' : 'mile'}.</span>
        </label>

        <h4 className="span-2 payslip-form-group">Loan</h4>
        <label className="span-2">
          Is there a loan on it?
          <select value={loanKind} onChange={(e) => setLoanKind(e.target.value as VehicleWriteBody['loan']['kind'])}>
            <option value="none">No loan</option>
            <option value="manual">Yes, I’ll enter the balance</option>
            <option value="account" disabled={!view.loanAccounts.length}>
              Yes, it’s one of my bank loan accounts{view.loanAccounts.length ? '' : ' (none added)'}
            </option>
          </select>
        </label>
        {loanKind === 'account' ? (
          <label className="span-2">
            Loan account
            <select value={loanAccount} onChange={(e) => setLoanAccount(e.target.value)}>
              {view.loanAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatNzd(Math.abs(a.balanceNzd))} owed)
                </option>
              ))}
            </select>
            <span className="muted small">Its balance already counts in net worth, so it isn’t taken off twice.</span>
          </label>
        ) : null}
        {loanKind === 'manual' ? (
          <label>
            Still owed (NZD)
            <input type="number" min={0} step="0.01" inputMode="decimal" value={loanBalance} onChange={(e) => setLoanBalance(e.target.value)} />
          </label>
        ) : null}
        {loanKind !== 'none' ? (
          <>
            <label>
              Lender (optional)
              <input value={lender} maxLength={60} onChange={(e) => setLender(e.target.value)} />
            </label>
            <label>
              Interest rate % (optional)
              <input type="number" min={0} max={100} step="0.01" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
            <label>
              Repayment (optional)
              <input type="number" min={0} step="0.01" inputMode="decimal" value={repay} onChange={(e) => setRepay(e.target.value)} />
            </label>
            <label>
              Paid
              <select value={repayFreq} onChange={(e) => setRepayFreq(e.target.value as VehicleCostFrequency)}>
                {COST_FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        <h4 className="span-2 payslip-form-group">Running costs (optional)</h4>
        {costs.map((c, i) => (
          <fieldset key={c.key} className="span-2 vehicle-cost-row">
            <legend className="sr-only">Running cost {i + 1}</legend>
            <label>
              What for
              <select value={c.kind} onChange={(e) => setCost(c.key, { kind: e.target.value as VehicleCostKind })}>
                {COST_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input type="number" min={0} step="0.01" inputMode="decimal" value={c.amount} onChange={(e) => setCost(c.key, { amount: e.target.value })} />
            </label>
            <label>
              How often
              <select value={c.frequency} onChange={(e) => setCost(c.key, { frequency: e.target.value as VehicleCostFrequency })}>
                {COST_FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="link-btn vehicle-cost-remove" aria-label={`Remove running cost ${i + 1}`} onClick={() => setCosts((cs) => cs.filter((x) => x.key !== c.key))}>
              Remove
            </button>
          </fieldset>
        ))}
        {costs.length < 20 ? (
          <div className="span-2 vehicle-cost-add">
            {COST_KINDS.filter((k) => !costs.some((c) => c.kind === k.value) || k.value === 'other')
              .slice(0, 6)
              .map((k) => (
                <button
                  key={k.value}
                  type="button"
                  className="btn small ghost"
                  onClick={() => setCosts((cs) => [...cs, { key: `n${Date.now().toString(36)}${k.value}`, kind: k.value, amount: '', frequency: k.defaultFrequency, label: '' }])}
                >
                  + {k.label}
                </button>
              ))}
          </div>
        ) : null}
        {preview.total.year > 0 ? (
          <p className="span-2 small" aria-live="polite">
            Costs {formatNzd(preview.total.month)} a month ({formatNzd(preview.total.week)} a week)
            {preview.loan.year > 0 ? `, including ${formatNzd(preview.loan.month)} loan repayments` : ''}.
          </p>
        ) : null}

        <label className="span-2">
          Notes (optional)
          <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn primary" disabled={busy || !!blocker} onClick={() => void save()}>
          {v ? 'Save changes' : 'Add vehicle'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        {blocker ? <span className="muted small">{blocker}</span> : null}
      </div>
    </Dialog>
  );
}
