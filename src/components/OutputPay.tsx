/**
 * Piece rate, contract (schedular) and share-of-catch sections of the PAYE page (KAN-70).
 * Inputs sit under the pay type selector. The summary is the PAYE page's result
 * panel; the breakdown stays on the page below the columns.
 * Rates come from the tax-year config (payeRates.ts PAY_TAX_YEARS).
 */
import { useEffect, useMemo, useState } from 'react';
import { api, formatNzd } from '../api/client';
import {
  calculatePieceRate,
  calculateSchedular,
  calculateShareOfCatch,
  OUTPUT_PAY_TYPE_LABELS,
  payRange,
  UNIT_PRESETS,
  weeklyCatchValue,
  weeklyToMonthly,
  type OutputPayType,
  type PayRangePoint,
  type PieceRatePayeOptions,
} from '../lib/outputPayCalc';
import {
  optionalQuantity,
  pieceUnitsPerWeek,
  prefsToSourceInputs,
  sourceInputsToPrefs,
  withholdingPct,
  type OutputPayPrefs,
} from '../lib/outputPayPrefs';
import { PAYE_WEEKS_PER_YEAR, type PayTaxYearRates } from '../lib/payeRates';
import type { PaySource } from '../types';

const PRESET_UNITS = new Set(UNIT_PRESETS.flatMap((g) => g.units));

type Setter = <K extends keyof OutputPayPrefs>(key: K, value: OutputPayPrefs[K]) => void;

function money(n: number): string {
  return formatNzd(n);
}

function num(text: string): number {
  const v = Number(text);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function NumberField({
  label,
  value,
  onChange,
  hint,
  step = 'any',
  max,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  step?: string | number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min={0}
        max={max}
        step={step}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span className="muted small">{hint}</span> : null}
    </label>
  );
}

function UnitField({ unit, onChange }: { unit: string; onChange: (u: string) => void }) {
  const custom = !PRESET_UNITS.has(unit);
  return (
    <>
      <label>
        Unit
        <select
          value={custom ? '__custom' : unit}
          onChange={(e) => onChange(e.target.value === '__custom' ? '' : e.target.value)}
        >
          {UNIT_PRESETS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.units.map((u) => (
                <option key={`${g.group}-${u}`} value={u}>
                  {u}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="__custom">Custom…</option>
        </select>
      </label>
      {custom ? (
        <label>
          Custom unit
          <input
            type="text"
            maxLength={40}
            value={unit}
            placeholder="e.g. sack"
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      ) : null}
    </>
  );
}

export function OutputPayInputs({
  payType,
  prefs,
  set,
  rates,
}: {
  payType: OutputPayType;
  prefs: OutputPayPrefs;
  set: Setter;
  rates: PayTaxYearRates;
}) {
  if (payType === 'piece') {
    return (
      <div className="form-grid" style={{ marginTop: '0.75rem' }}>
        <NumberField label="Rate per unit ($)" value={prefs.pieceRate} onChange={(v) => set('pieceRate', v)} placeholder="e.g. 30" />
        <UnitField unit={prefs.unit} onChange={(u) => set('unit', u)} />
        <NumberField label={`Units (${prefs.unit || 'unit'}) per day`} value={prefs.unitsPerDay} onChange={(v) => set('unitsPerDay', v)} />
        <NumberField label="Days per week" value={prefs.daysPerWeek} onChange={(v) => set('daysPerWeek', v)} max={7} step={0.5} />
        <NumberField
          label="Hours worked per week"
          value={prefs.pieceHours}
          onChange={(v) => set('pieceHours', v)}
          max={168}
          step={0.5}
          hint="Used for the effective hourly rate and the minimum wage check."
        />
        <label className="field checkbox-field">
          <label className="inline-check">
            <input type="checkbox" checked={prefs.holidayPay} onChange={(e) => set('holidayPay', e.target.checked)} />
            8% holiday pay paid with wages
          </label>
          <span className="muted small">For seasonal or casual work paid holiday pay each pay instead of taking leave.</span>
        </label>
        <RangeFields
          label={`${prefs.unit || 'units'} per week`}
          low={prefs.pieceLow}
          high={prefs.pieceHigh}
          onLow={(v) => set('pieceLow', v)}
          onHigh={(v) => set('pieceHigh', v)}
        />
      </div>
    );
  }

  if (payType === 'schedular') {
    const wt = withholdingPct(prefs, rates);
    return (
      <div className="form-grid" style={{ marginTop: '0.75rem' }}>
        <NumberField label="Rate per unit or job ($, excl. GST)" value={prefs.contractRate} onChange={(v) => set('contractRate', v)} />
        <UnitField unit={prefs.unit} onChange={(u) => set('unit', u)} />
        <NumberField label={`Volume per week (${prefs.unit || 'units'})`} value={prefs.contractVolume} onChange={(v) => set('contractVolume', v)} />
        <label className="span-2">
          Withholding tax rate (IR330C)
          <select value={prefs.activity} onChange={(e) => set('activity', e.target.value)}>
            {rates.schedularActivities.map((a) => (
              <option key={a.number} value={String(a.number)}>
                {a.number}. {a.label} — {Math.round(a.rate * 1000) / 10}%
              </option>
            ))}
            <option value="custom">Your own rate or a tailored rate certificate</option>
          </select>
          <span className="muted small">
            Standard rate for the activity, from IRD&apos;s IR330C. You can elect a rate of at least{' '}
            {Math.round(rates.schedularElectedMinRate * 100)}%, or use a tailored rate. With no IR330C the payer
            must take {Math.round(rates.schedularNoNotificationRate * 100)}%.
          </span>
        </label>
        {prefs.activity === 'custom' ? (
          <NumberField
            label="Your rate (%)"
            value={prefs.customWtRate}
            onChange={(v) => set('customWtRate', v)}
            max={100}
            step={0.1}
            hint="One decimal place, as on the IR330C."
          />
        ) : (
          <p className="muted small" style={{ alignSelf: 'end' }}>Rate used: {wt}%</p>
        )}
        <label className="field checkbox-field">
          <label className="inline-check">
            <input type="checkbox" checked={prefs.gstRegistered} onChange={(e) => set('gstRegistered', e.target.checked)} />
            GST registered
          </label>
          <span className="muted small">Adds {Math.round(rates.gstRate * 100)}% GST to the invoice. Withholding is on the GST-exclusive amount.</span>
        </label>
        <RangeFields
          label={`${prefs.unit || 'units'} per week`}
          low={prefs.contractLow}
          high={prefs.contractHigh}
          onLow={(v) => set('contractLow', v)}
          onHigh={(v) => set('contractHigh', v)}
        />
      </div>
    );
  }

  return (
    <div className="form-grid" style={{ marginTop: '0.75rem' }}>
      <NumberField label="Catch value ($)" value={prefs.catchValue} onChange={(v) => set('catchValue', v)} />
      <label>
        Catch value is per
        <select value={prefs.catchPer} onChange={(e) => set('catchPer', e.target.value === 'week' ? 'week' : 'trip')}>
          <option value="trip">Trip</option>
          <option value="week">Week</option>
        </select>
      </label>
      {prefs.catchPer === 'trip' ? (
        <NumberField label="Trips per week" value={prefs.tripsPerWeek} onChange={(v) => set('tripsPerWeek', v)} step={0.5} />
      ) : null}
      <NumberField label="Your share (%)" value={prefs.sharePct} onChange={(v) => set('sharePct', v)} max={100} step={0.1} />
      <NumberField
        label="Your expenses per week ($, optional)"
        value={prefs.expensesPerWeek}
        onChange={(v) => set('expensesPerWeek', v)}
        hint="Costs you pay yourself, such as gear or travel."
      />
      <RangeFields
        label={`catch value per ${prefs.catchPer}`}
        low={prefs.catchLow}
        high={prefs.catchHigh}
        onLow={(v) => set('catchLow', v)}
        onHigh={(v) => set('catchHigh', v)}
      />
    </div>
  );
}

function RangeFields({
  label,
  low,
  high,
  onLow,
  onHigh,
}: {
  label: string;
  low: string;
  high: string;
  onLow: (v: string) => void;
  onHigh: (v: string) => void;
}) {
  return (
    <>
      <NumberField label={`Low week — ${label} (optional)`} value={low} onChange={onLow} />
      <NumberField
        label={`High week — ${label} (optional)`}
        value={high}
        onChange={onHigh}
        hint="Output changes week to week. Fill these to see a pay range."
      />
    </>
  );
}

function RangeTable({ points, quantityLabel, netLabel }: { points: PayRangePoint[]; quantityLabel: string; netLabel: string }) {
  if (points.length < 2) return null;
  return (
    <div style={{ overflowX: 'auto' }}>
      <h4 style={{ margin: '1rem 0 0.25rem' }}>Pay range</h4>
      <table className="data-table">
        <thead>
          <tr>
            <th>Week</th>
            <th style={{ textAlign: 'right' }}>{quantityLabel}</th>
            <th style={{ textAlign: 'right' }}>Gross</th>
            <th style={{ textAlign: 'right' }}>{netLabel}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              <td style={{ textAlign: 'right' }}>{p.quantity.toLocaleString('en-NZ')}</td>
              <td className="money" style={{ textAlign: 'right' }}>{money(p.weeklyGross)}</td>
              <td className="money amt-in" style={{ textAlign: 'right' }}>{money(p.weeklyNet)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Row = { label: string; week: number; deduct?: boolean; strong?: boolean };

function WeekYearTable({ rows }: { rows: Row[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ marginTop: '0.75rem' }}>
        <thead>
          <tr>
            <th>Item</th>
            <th style={{ textAlign: 'right' }}>Week</th>
            <th style={{ textAlign: 'right' }}>Month</th>
            <th style={{ textAlign: 'right' }}>Year</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cls = r.strong ? 'money amt-in' : r.deduct ? 'money amt-out' : 'money';
            return (
              <tr key={r.label}>
                <td>
                  {r.label}
                  {r.deduct ? <span className="muted"> (−)</span> : null}
                </td>
                <td className={cls} style={{ textAlign: 'right' }}>{money(r.week)}</td>
                <td className={cls} style={{ textAlign: 'right' }}>{money(weeklyToMonthly(r.week))}</td>
                <td className={cls} style={{ textAlign: 'right' }}>{money(r.week * PAYE_WEEKS_PER_YEAR)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="muted small" style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem' }}>
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

export function OutputPayResults({
  payType,
  prefs,
  payeOptions,
  rates,
  part,
}: {
  payType: OutputPayType;
  prefs: OutputPayPrefs;
  payeOptions: PieceRatePayeOptions;
  rates: PayTaxYearRates;
  /** Summary fills the sticky result panel. Breakdown stays below the columns. */
  part: 'summary' | 'breakdown';
}) {
  const view = useMemo(() => {
    if (payType === 'piece') {
      const hours = num(prefs.pieceHours);
      const calc = (units: number) =>
        calculatePieceRate(
          { ratePerUnit: num(prefs.pieceRate), unitsPerWeek: units, hoursPerWeek: hours, holidayPayWithWages: prefs.holidayPay },
          payeOptions,
          rates,
        );
      const typical = pieceUnitsPerWeek(prefs);
      const r = calc(typical);
      const range = payRange(typical, optionalQuantity(prefs.pieceLow), optionalQuantity(prefs.pieceHigh), (q) => {
        const x = calc(q);
        return { weeklyGross: x.weeklyGross, weeklyNet: x.weeklyTakeHome };
      });
      return { kind: 'piece' as const, r, range, hasInput: r.pieceEarnings > 0 };
    }
    if (payType === 'schedular') {
      const wt = withholdingPct(prefs, rates);
      const calc = (units: number) =>
        calculateSchedular(
          { ratePerUnit: num(prefs.contractRate), unitsPerWeek: units, withholdingRatePct: wt, gstRegistered: prefs.gstRegistered },
          rates,
        );
      const typical = num(prefs.contractVolume);
      const r = calc(typical);
      const range = payRange(typical, optionalQuantity(prefs.contractLow), optionalQuantity(prefs.contractHigh), (q) => {
        const x = calc(q);
        return { weeklyGross: x.weeklyGross, weeklyNet: x.weeklyNet };
      });
      return { kind: 'schedular' as const, r, range, hasInput: r.weeklyGross > 0 };
    }
    const calc = (catchValue: number) =>
      calculateShareOfCatch({
        catchValue,
        per: prefs.catchPer,
        tripsPerWeek: num(prefs.tripsPerWeek),
        sharePct: num(prefs.sharePct),
        expensesPerWeek: num(prefs.expensesPerWeek),
      });
    const typical = num(prefs.catchValue);
    const r = calc(typical);
    const range = payRange(typical, optionalQuantity(prefs.catchLow), optionalQuantity(prefs.catchHigh), (q) => {
      const x = calc(q);
      return { weeklyGross: x.weeklyShare, weeklyNet: x.weeklyNet };
    });
    return { kind: 'share' as const, r, range, hasInput: r.weeklyShare > 0 };
  }, [payType, prefs, payeOptions, rates]);

  if (!view.hasInput) {
    if (part === 'breakdown') return null;
    return (
      <p className="muted paye-result-empty">
        Enter a rate and how much you produce above to work out your pay.
      </p>
    );
  }

  const unit = prefs.unit || 'unit';

  if (view.kind === 'piece') {
    const { r } = view;
    const p = r.paye;
    if (part === 'summary') {
      return (
        <>
          <div className="panel-heading">
            <h2>Take-home pay</h2>
            <span className="muted small">Piece rate · tax code {p.taxCode}</span>
          </div>
          <p className="paye-result-figure">
            <span className="hero-value">{money(r.weeklyTakeHome)}</span>
            <span className="muted">/ week</span>
          </p>
          <p className="muted small paye-result-meta">{money(p.takeHome)}/yr</p>
          <p className="muted small paye-result-meta">
            Gross {money(r.weeklyGross)}/wk · {money(r.annualGross)}/yr · Effective hourly{' '}
            {r.effectiveHourly == null ? '—' : `${money(r.effectiveHourly)}/h`} (piece earnings ÷ hours)
          </p>
          {r.belowMinimumWage ? (
            <p className="banner paye-result-meta">
              {money(r.effectiveHourly ?? 0)}/h is below the adult minimum wage of {money(r.minimumWageHourly)}/h ({rates.label}).
              Employers must top piece-rate pay up to at least minimum wage for the hours worked. Topped up, this week is{' '}
              {money(r.earnings)} before holiday pay ({money(r.topUp)} top-up). The figures below use the topped-up amount.
            </p>
          ) : null}
          <Notes notes={p.notes} />
        </>
      );
    }
    const perWeek = (annual: number) => annual / PAYE_WEEKS_PER_YEAR;
    const rows: Row[] = [{ label: `Piece earnings (${unit})`, week: r.pieceEarnings }];
    if (r.topUp > 0) rows.push({ label: 'Minimum wage top-up', week: r.topUp });
    if (r.holidayPay > 0) rows.push({ label: '8% holiday pay', week: r.holidayPay });
    rows.push({ label: 'Gross pay', week: r.weeklyGross });
    rows.push({ label: 'PAYE (tax + ACC − credits)', week: perWeek(p.payeNetOfCredits), deduct: true });
    if (p.kiwiSaverEmployee > 0) rows.push({ label: 'KiwiSaver (employee)', week: perWeek(p.kiwiSaverEmployee), deduct: true });
    if (p.studentLoan > 0) rows.push({ label: 'Student loan', week: perWeek(p.studentLoan), deduct: true });
    if (p.payrollGivingDonation > 0) rows.push({ label: 'Payroll giving', week: perWeek(p.payrollGivingDonation), deduct: true });
    rows.push({ label: 'Take-home pay', week: r.weeklyTakeHome, strong: true });
    return (
      <section className="panel">
        <h3>Breakdown</h3>
        <WeekYearTable rows={rows} />
        <RangeTable points={view.range} quantityLabel={`${unit} / week`} netLabel="Take-home" />
        <p className="muted small" style={{ marginTop: '0.75rem' }}>
          Deductions use the same PAYE engine as the salary tool (KiwiSaver, student loan and credits from the sections above).
        </p>
      </section>
    );
  }

  if (view.kind === 'schedular') {
    const { r } = view;
    if (part === 'summary') {
      return (
        <>
          <div className="panel-heading">
            <h2>Net received</h2>
            <span className="muted small">Contract (schedular) · tax code WT</span>
          </div>
          <p className="paye-result-figure">
            <span className="hero-value">{money(r.weeklyNet)}</span>
            <span className="muted">/ week</span>
          </p>
          <p className="muted small paye-result-meta">{money(r.annualNet)}/yr</p>
          <p className="muted small paye-result-meta">
            Gross {money(r.weeklyGross)}/wk · tax withheld {money(r.weeklyTaxWithheld)}/wk
          </p>
          <Notes notes={r.notes} />
        </>
      );
    }
    const rows: Row[] = [{ label: `Earned (${unit}, excl. GST)`, week: r.weeklyGross }];
    if (r.weeklyGst > 0) rows.push({ label: 'GST invoiced', week: r.weeklyGst });
    rows.push({ label: `Withholding tax (${Math.round(r.withholdingRate * 1000) / 10}%)`, week: r.weeklyTaxWithheld, deduct: true });
    if (r.weeklyGst > 0) rows.push({ label: 'Paid into your bank (incl. GST)', week: r.weeklyPaid });
    rows.push({ label: 'Net received (excl. GST)', week: r.weeklyNet, strong: true });
    return (
      <section className="panel">
        <h3>Breakdown</h3>
        <WeekYearTable rows={rows} />
        <RangeTable points={view.range} quantityLabel={`${unit} / week`} netLabel="Net received" />
      </section>
    );
  }

  const { r } = view;
  const perTrip = prefs.catchPer === 'trip';
  if (part === 'summary') {
    return (
      <>
        <div className="panel-heading">
          <h2>Your share</h2>
          <span className="muted small">Share of catch · self-employed</span>
        </div>
        <p className="paye-result-figure">
          <span className="hero-value">{money(r.weeklyShare)}</span>
          <span className="muted">/ week gross share</span>
        </p>
        <p className="muted small paye-result-meta">{money(r.annualShare)}/yr</p>
        <p className="muted small paye-result-meta">
          Net after expenses {money(r.weeklyNet)}/wk. If this were your only income, income tax on {money(r.annualNet)} would be
          about {money(r.estimatedAnnualIncomeTax)} for the year, paid through your return — not deducted here.
        </p>
        <Notes notes={r.notes} />
      </>
    );
  }
  const rows: Row[] = [
    { label: 'Catch value', week: r.weeklyCatchValue },
    { label: 'Your share', week: r.weeklyShare },
  ];
  if (r.weeklyExpenses > 0) rows.push({ label: 'Your expenses', week: r.weeklyExpenses, deduct: true });
  rows.push({ label: 'Net share (before tax)', week: r.weeklyNet, strong: true });
  return (
    <section className="panel">
      <h3>Breakdown</h3>
      <WeekYearTable rows={rows} />
      <RangeTable
        points={view.range}
        quantityLabel={perTrip ? 'Catch / trip ($)' : 'Catch / week ($)'}
        netLabel="Net share"
      />
      {perTrip ? (
        <p className="muted small" style={{ marginTop: '0.5rem' }}>
          Weekly catch = catch per trip × {num(prefs.tripsPerWeek)} trip(s) ={' '}
          {money(weeklyCatchValue({ catchValue: num(prefs.catchValue), per: 'trip', tripsPerWeek: num(prefs.tripsPerWeek) }))}.
        </p>
      ) : null}
    </section>
  );
}

export function SavedPaySources({
  payType,
  prefs,
  setPrefs,
  payeOptions,
  rates,
  onLoadPayType,
}: {
  payType: OutputPayType;
  prefs: OutputPayPrefs;
  setPrefs: (p: OutputPayPrefs) => void;
  payeOptions: PieceRatePayeOptions;
  rates: PayTaxYearRates;
  onLoadPayType: (t: OutputPayType) => void;
}) {
  const [sources, setSources] = useState<PaySource[] | null>(null);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shownType, setShownType] = useState(payType);
  // Switching pay type starts a fresh save unless that switch came from loading a source.
  if (shownType !== payType) {
    setShownType(payType);
    if (!(sources ?? []).some((x) => x.id === editingId && x.payType === payType)) {
      setEditingId(null);
      setName('');
    }
    setMsg(null);
  }

  useEffect(() => {
    let cancelled = false;
    api.paySources
      .list()
      .then((rows) => {
        if (!cancelled) setSources(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setSources([]);
          setError(e instanceof Error ? e.message : 'Could not load saved pay sources.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultName =
    payType === 'share_of_catch'
      ? 'Share of catch'
      : `${OUTPUT_PAY_TYPE_LABELS[payType]} — ${prefs.unit || 'unit'}`;

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const body = {
        name: name.trim() || defaultName,
        taxYear: rates.startYear,
        inputs: prefsToSourceInputs(payType, prefs, payeOptions, withholdingPct(prefs, rates)),
      };
      const saved = editing
        ? await api.paySources.update(editing.id, body)
        : await api.paySources.create(body);
      setSources((prev) => {
        const list = prev ?? [];
        return list.some((x) => x.id === saved.id)
          ? list.map((x) => (x.id === saved.id ? saved : x))
          : [...list, saved];
      });
      setEditingId(saved.id);
      setName(saved.name);
      setMsg(`Saved “${saved.name}”: ${money(saved.weeklyNetNzd)}/wk (${money(saved.monthlyNetNzd)}/mo) now counts as expected income.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(source: PaySource) {
    if (!window.confirm(`Remove “${source.name}” from your income sources?`)) return;
    setError(null);
    try {
      await api.paySources.remove(source.id);
      setSources((prev) => (prev ?? []).filter((s) => s.id !== source.id));
      if (editingId === source.id) {
        setEditingId(null);
        setName('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove.');
    }
  }

  function load(source: PaySource) {
    if (!source.inputs) return;
    onLoadPayType(source.inputs.payType);
    setPrefs(sourceInputsToPrefs(source.inputs, prefs));
    setEditingId(source.id);
    setName(source.name);
    setMsg(null);
  }

  const totalWeekly = (sources ?? []).reduce((s, x) => s + x.weeklyNetNzd, 0);
  // Only update in place when the loaded source has the pay type on screen.
  const editing = (sources ?? []).find((x) => x.id === editingId && x.payType === payType) ?? null;

  return (
    <section className="panel">
      <div className="panel-heading">
        <h3>Save as income source</h3>
        <span className="muted small">Feeds Budget, Home and Projections</span>
      </div>
      <p className="muted small" style={{ marginTop: '0.35rem' }}>
        The typical weekly amount you take home is saved as expected income for your account. Budget and Home show it beside
        what you actually receive; Projections use it when no income is recorded yet.
      </p>
      <div className="form-grid" style={{ marginTop: '0.5rem' }}>
        <label className="span-2">
          Name
          <input type="text" maxLength={120} value={name} placeholder={defaultName} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <div className="row gap" style={{ marginTop: '0.5rem' }}>
        <button type="button" className="btn small primary" disabled={busy} onClick={() => void save()}>
          {editing ? 'Update income source' : 'Save as income source'}
        </button>
        {editing ? (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setEditingId(null);
              setName('');
              setMsg(null);
            }}
          >
            Save as new instead
          </button>
        ) : null}
      </div>
      {msg ? <p className="banner" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {sources && sources.length > 0 ? (
        <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Week</th>
                <th style={{ textAlign: 'right' }}>Month</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}{editing?.id === s.id ? <span className="muted small"> · editing</span> : null}</td>
                  <td>{OUTPUT_PAY_TYPE_LABELS[s.payType] ?? s.payType}</td>
                  <td className="money" style={{ textAlign: 'right' }}>{money(s.weeklyNetNzd)}</td>
                  <td className="money" style={{ textAlign: 'right' }}>{money(s.monthlyNetNzd)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn small" disabled={!s.inputs} onClick={() => load(s)}>
                      Load
                    </button>{' '}
                    <button type="button" className="btn small danger" onClick={() => void remove(s)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={2}><strong>Total expected</strong></td>
                <td className="money amt-in" style={{ textAlign: 'right' }}>{money(totalWeekly)}</td>
                <td className="money amt-in" style={{ textAlign: 'right' }}>{money(weeklyToMonthly(totalWeekly))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      ) : sources ? (
        <p className="muted small" style={{ marginTop: '0.75rem' }}>No saved pay sources yet.</p>
      ) : null}
    </section>
  );
}
