/**
 * Portfolio → Bonds (KAN-80): government and corporate bonds and term deposits.
 * Value is what you record, else cost; never a market price. Plus adds the coupon calendar,
 * coupons into Income, projections and maturity alerts. Amounts follow Hide amounts.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, formatNzd } from '../../api/client';
import type { Bond, BondPayment, BondWriteBody, BondsView, BondKind, CouponFrequency } from '../../types';
import { BOND_KIND_LABEL, FREQUENCY_LABEL, RWT_CHOICES, bondSchedule } from '../../lib/bondSchedule';
import { longDate } from '../../pages/warrantiesView';
import { ClassHeading } from './ClassHeading';
import { InfoTip } from '../InfoTip';

const CURRENCIES = ['NZD', 'AUD', 'USD', 'EUR', 'GBP'];
const money = (n: number, currency: string) => (currency === 'NZD' ? formatNzd(n) : `${currency} ${n.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

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

type FormMode = { mode: 'add' } | { mode: 'edit'; bond: Bond } | { mode: 'rollover'; bond: Bond };
const s = (n: number | null | undefined) => (n == null ? '' : String(n));
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

function BondForm({ view, mode, onClose, onSaved }: { view: BondsView; mode: FormMode; onClose: () => void; onSaved: (v: BondsView, note: string) => void }) {
  const b = mode.mode === 'add' ? null : mode.bond;
  const roll = mode.mode === 'rollover';
  const [name, setName] = useState(b?.name ?? '');
  const [kind, setKind] = useState<BondKind>(b?.kind ?? 'td');
  const [code, setCode] = useState(roll ? '' : (b?.code ?? ''));
  const [face, setFace] = useState(s(b?.faceValue));
  const [price, setPrice] = useState(s(b?.faceValue && roll ? b.faceValue : b?.purchasePrice));
  const [bought, setBought] = useState(roll ? (b?.maturityDate ?? '') : (b?.purchaseDate ?? ''));
  const [rate, setRate] = useState(roll ? '' : s(b?.ratePct));
  const [freq, setFreq] = useState<CouponFrequency>(b?.frequency ?? 'maturity');
  const [maturity, setMaturity] = useState(roll ? '' : (b?.maturityDate ?? ''));
  const [currency, setCurrency] = useState(b?.currency ?? 'NZD');
  const [rwt, setRwt] = useState(s(b?.rwtPct));
  const [value, setValue] = useState(roll ? '' : s(b?.valueAmount));
  const [valueOn, setValueOn] = useState(roll ? '' : (b?.valueOn ?? ''));
  const [linked, setLinked] = useState(roll ? '' : (b?.linkedAccountId ?? ''));
  const [notes, setNotes] = useState(roll ? '' : (b?.notes ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = Number(face) > 0 && Number(rate) >= 0 && rate !== '' && bought && maturity && maturity > bought;
  const preview = ready
    ? bondSchedule({ kind, faceValue: Number(face), ratePct: Number(rate), frequency: freq, purchaseDate: bought, maturityDate: maturity, rwtPct: numOrNull(rwt) }).filter((p) => p.kind === 'coupon')
    : [];
  const blocker = !name.trim() ? 'Enter the name or issuer' : !(Number(face) > 0) ? 'Enter the face value' : price === '' ? 'Enter what you paid' : !bought || !maturity ? 'Enter both dates' : maturity <= bought ? 'Maturity must be after the purchase date' : rate === '' ? 'Enter the rate' : null;

  async function save() {
    setBusy(true);
    setError(null);
    const body: BondWriteBody = {
      name: name.trim(),
      kind,
      faceValue: Number(face),
      purchasePrice: Number(price),
      purchaseDate: bought,
      ratePct: Number(rate),
      frequency: freq,
      maturityDate: maturity,
      currency,
      code: code.trim(),
      rwtPct: numOrNull(rwt),
      valueAmount: numOrNull(value),
      valueOn: valueOn || null,
      linkedAccountId: kind === 'td' && linked ? linked : null,
      notes: notes.trim(),
    };
    try {
      const v = mode.mode === 'edit' ? await api.bonds.update(mode.bond.id, body) : mode.mode === 'rollover' ? await api.bonds.rollOver(mode.bond.id, body) : await api.bonds.create(body);
      onSaved(v, mode.mode === 'rollover' ? `${b!.name} rolled over.` : mode.mode === 'edit' ? `${body.name} updated.` : `${body.name} added.`);
    } catch (e) {
      setError(errText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={roll ? `Roll over ${b!.name}` : b ? `Edit ${b.name}` : 'Add a bond or term deposit'} onClose={onClose}>
      <div className="form-grid crypto-form">
        {roll ? <p className="span-2 muted small">The old one closes as rolled over on the new start date. Enter the new rate and maturity.</p> : null}
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as BondKind)}>
            {(Object.keys(BOND_KIND_LABEL) as BondKind[]).map((k) => (
              <option key={k} value={k}>{BOND_KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label>
          {kind === 'td' ? 'Bank' : 'Name or issuer'}
          <input value={name} maxLength={80} placeholder={kind === 'td' ? 'e.g. ASB 6-month TD' : 'e.g. NZ Govt 4.5% 2029'} onChange={(e) => setName(e.target.value)} />
        </label>
        {kind !== 'td' ? (
          <label>
            ISIN or NZX code (optional)
            <input value={code} maxLength={20} autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} />
          </label>
        ) : null}
        <label>
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {[...new Set([...CURRENCIES, currency])].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          {kind === 'td' ? 'Amount invested' : 'Face value'}
          <input type="number" min={0} step="0.01" inputMode="decimal" value={face} onChange={(e) => setFace(e.target.value)} />
        </label>
        <label>
          {kind === 'td' ? 'Amount paid in' : 'Price paid'}
          <input type="number" min={0} step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label>
          {roll ? 'New start date' : 'Bought / started on'}
          <input type="date" value={bought} onChange={(e) => setBought(e.target.value)} />
        </label>
        <label>
          Matures on
          <input type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} />
        </label>
        <label>
          {kind === 'td' ? 'Interest rate (% a year)' : 'Coupon rate (% a year)'}
          <input type="number" min={0} max={100} step="0.01" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label>
          Pays
          <select value={freq} onChange={(e) => setFreq(e.target.value as CouponFrequency)}>
            {(Object.keys(FREQUENCY_LABEL) as CouponFrequency[]).map((f) => (
              <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>
            ))}
          </select>
        </label>
        <label>
          RWT rate
          <select value={rwt} onChange={(e) => setRwt(e.target.value)}>
            <option value="">Not set (show before tax)</option>
            {RWT_CHOICES.map((r) => (
              <option key={r} value={String(r)}>{r}%</option>
            ))}
          </select>
          <span className="muted small">Resident withholding tax taken from the interest (IRD rates).</span>
        </label>
        {preview.length ? (
          <p className="span-2 small" aria-live="polite">
            {preview.length === 1 ? 'Pays' : `Pays ${preview.length} times, each about`} {money(preview[0].net, currency)}
            {rwt ? ` after RWT (${money(preview[0].gross, currency)} before)` : ''}, first on {longDate(preview[0].date)}, plus {money(Number(face), currency)} back on {longDate(maturity)}.
          </p>
        ) : null}
        <label>
          Value now (optional)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          <span className="muted small">Leave blank to use what you paid. No market price is looked up.</span>
        </label>
        <label>
          Valued on
          <input type="date" value={valueOn} onChange={(e) => setValueOn(e.target.value)} />
        </label>
        {kind === 'td' && view.termDepositAccounts.length ? (
          <label className="span-2">
            Is this one of your synced term deposit accounts?
            <select value={linked} onChange={(e) => setLinked(e.target.value)}>
              <option value="">No, count it here</option>
              {view.termDepositAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatNzd(a.balanceNzd)}): already in Cash, don’t count again
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="span-2">
          Notes (optional)
          <input value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn primary" disabled={busy || !!blocker} onClick={() => void save()}>
          {roll ? 'Roll over' : b ? 'Save changes' : 'Add'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        {blocker ? <span className="muted small">{blocker}</span> : null}
      </div>
    </Dialog>
  );
}

function PaymentRow({ p, onChange, past }: { p: BondPayment; onChange: (v: BondsView, note: string) => void; past?: boolean }) {
  const [edit, setEdit] = useState(false);
  const [amt, setAmt] = useState(String(p.recorded ?? p.net));
  const amount = p.recorded ?? p.net;
  const act = (body: { skipped?: boolean; netAmount?: number | null }, note: string) =>
    void api.bonds.setCoupon(p.bondId, p.date, body).then((v) => onChange(v, note));
  return (
    <li className={'hh-row-wrap' + (p.skipped ? ' crypto-import-ignored' : '')}>
      <span>
        {longDate(p.date)} <span className="muted small">· {p.bondName} · {p.kind === 'principal' ? 'principal back' : p.skipped ? 'skipped' : past ? (p.inIncome ? 'in Income' : 'paid') : 'interest'}</span>
      </span>
      <span className="money">{money(amount, p.currency)}</span>
      {p.kind === 'coupon' ? (
        <span className="payslip-actions">
          {past && !p.skipped ? (
            <button type="button" className="link-btn" onClick={() => setEdit((x) => !x)}>
              Amount received
            </button>
          ) : null}
          <button type="button" className="link-btn" onClick={() => act({ skipped: !p.skipped, netAmount: p.recorded }, p.skipped ? 'Coupon restored.' : 'Coupon skipped.')}>
            {p.skipped ? 'Restore' : 'Skip'}
          </button>
        </span>
      ) : null}
      {edit ? (
        <form
          className="hh-amount-edit"
          onSubmit={(e) => {
            e.preventDefault();
            act({ skipped: false, netAmount: Number(amt) }, 'Amount saved.');
            setEdit(false);
          }}
        >
          <label htmlFor={`amt-${p.bondId}-${p.date}`}>Received after RWT</label>
          <input id={`amt-${p.bondId}-${p.date}`} type="number" min={0} step="0.01" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
          <button type="submit" className="btn primary">Save</button>
        </form>
      ) : null}
    </li>
  );
}

export function BondsPanel({ total, onChanged }: { total: number | null; onChanged: () => void }) {
  const [view, setView] = useState<BondsView | null>(null);
  const [form, setForm] = useState<FormMode | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.bonds.list().then(setView).catch((e: unknown) => setError(errText(e, 'Could not load bonds.')));
  }, []);
  useEffect(load, [load]);
  const changed = (v: BondsView, note: string) => {
    setView(v);
    setMsg(note);
    setForm(null);
    onChanged();
  };

  const active = view?.bonds.filter((b) => b.status === 'active') ?? [];
  const closed = view?.bonds.filter((b) => b.status !== 'active') ?? [];

  return (
    <section className="panel">
      <ClassHeading
        title="Bonds"
        total={total}
        info={
          <InfoTip label="About bond values">
            Government and corporate bonds and term deposits, at the value you record or what you paid. No market price is estimated. A term deposit linked to a synced
            bank account is already in Cash, so it isn’t counted again.
          </InfoTip>
        }
      >
        <button type="button" className="btn small primary" onClick={() => setForm({ mode: 'add' })} disabled={!view}>
          + Add
        </button>
      </ClassHeading>
      {msg ? <p className="banner">{msg}</p> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {!view && !error ? <p className="muted">Loading…</p> : null}

      {view?.alerts?.length ? (
        <ul className="bond-alerts">
          {view.alerts.map((a) => {
            const b = view.bonds.find((x) => x.id === a.bondId)!;
            return (
              <li key={a.bondId} className={a.level === 'matured' || a.level === '30' ? 'bond-alert-soon' : undefined}>
                <span>
                  <strong>{a.name}</strong> {a.level === 'matured' ? `matured on ${longDate(a.maturityDate)}` : `matures in ${a.days} day${a.days === 1 ? '' : 's'} (${longDate(a.maturityDate)})`}
                </span>
                <span className="payslip-actions">
                  <button type="button" className="btn small" onClick={() => setForm({ mode: 'rollover', bond: b })}>
                    Roll over
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => void api.bonds.repaid(b.id).then((v) => changed(v, `${b.name} marked repaid.`))}>
                    Mark repaid
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {view && !view.bonds.length ? <p className="muted">No bonds or term deposits yet.</p> : null}
      {active.length ? (
        <div className="payslip-list">
          {active.map((b) => (
            <article key={b.id} className="payslip-card">
              <div className="payslip-card-top">
                <div>
                  <h4>{b.name}</h4>
                  <p className="muted small">
                    {BOND_KIND_LABEL[b.kind]}
                    {b.code ? ` · ${b.code}` : ''} · {b.ratePct}% {FREQUENCY_LABEL[b.frequency].toLowerCase()} · matures {longDate(b.maturityDate)}
                  </p>
                </div>
                {b.countedInCash ? <span className="payslip-badge">In Cash</span> : null}
              </div>
              <dl className="payslip-figs">
                <div>
                  <dt>{b.valueSource === 'recorded' ? 'Value' : 'Cost'}</dt>
                  <dd className="money">{money(b.value, b.currency)}</dd>
                </div>
                <div>
                  <dt>Face value</dt>
                  <dd className="money">{money(b.faceValue, b.currency)}</dd>
                </div>
                <div>
                  <dt>Next interest</dt>
                  <dd className="money">{b.nextCoupon ? money(b.nextCoupon.net, b.currency) : '—'}</dd>
                </div>
              </dl>
              <p className="small muted">
                {b.nextCoupon ? `Next on ${longDate(b.nextCoupon.date)}. ` : ''}
                {b.valueSource === 'recorded' && b.valueOn ? `Valued ${longDate(b.valueOn)}. ` : ''}
                {b.currency !== 'NZD' ? (b.valueNzd != null ? `${formatNzd(b.valueNzd)} at today’s FX rate. ` : 'No NZD rate yet, so it’s not in net worth. ') : ''}
                {b.countedInCash ? `Same money as your ${b.linkedAccountName ?? 'term deposit'} account, which Cash already counts.` : ''}
              </p>
              <div className="payslip-actions">
                <button type="button" className="link-btn" onClick={() => setForm({ mode: 'edit', bond: b })}>
                  Edit
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => window.confirm(`Delete ${b.name}? Its interest comes out of Income too; bank transactions stay.`) && void api.bonds.remove(b.id).then((v) => changed(v, `${b.name} deleted.`))}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {view ? (
        view.plus ? (
          <>
            <h4 className="bond-sub">Next 12 months</h4>
            {view.calendar?.length ? (
              <ul className="hh-rows">
                {view.calendar.map((p) => (
                  <PaymentRow key={`${p.bondId}-${p.date}-${p.kind}`} p={p} onChange={changed} />
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing due in the next 12 months.</p>
            )}
            {view.recent?.length ? (
              <details className="proj-fold">
                <summary>Paid recently ({view.recent.length})</summary>
                <ul className="hh-rows">
                  {view.recent.map((p) => (
                    <PaymentRow key={`${p.bondId}-${p.date}`} p={p} onChange={changed} past />
                  ))}
                </ul>
              </details>
            ) : null}
            <p className="muted small">Interest in NZD goes into Income on its date (after RWT), matched to the bank deposit so it isn’t counted twice.</p>
          </>
        ) : view.bonds.length ? (
          <p className="small payslip-plan">KoruLedger Plus adds a coupon calendar, interest into Income matched to your bank deposits, bonds in Projections, and maturity reminders.</p>
        ) : null
      ) : null}

      {closed.length ? (
        <details className="proj-fold">
          <summary>Closed ({closed.length})</summary>
          <ul className="hh-rows">
            {closed.map((b) => (
              <li key={b.id}>
                <span>
                  {b.name} <span className="muted small">· {b.status === 'rolled' ? 'rolled over' : 'repaid'} {b.closedOn ? longDate(b.closedOn) : ''}</span>
                </span>
                <span className="money">{money(b.faceValue, b.currency)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {form && view ? <BondForm view={view} mode={form} onClose={() => setForm(null)} onSaved={changed} /> : null}
    </section>
  );
}
