/**
 * Projections (KAN-17): forward net worth and savings from GET /api/projections (PR #41).
 * Educational only — every figure comes from the user's balances, payments and cashflow,
 * plus the return / saving the user types in. The page renders the API; it does not project.
 * Inputs live in the URL (?months=&annualReturnPercent=&monthlySavingNzd=&savingWindowMonths=)
 * so a scenario can be bookmarked or shared.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api, formatNzd } from '../api/client';
import { AssetLineChart, type LineSeries } from '../components/AssetLineChart';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { showQuietToast } from '../lib/quietToast';
import type { ProjectionAssetClass, ProjectionAssumption, ProjectionResponse } from '../types';
import {
  PROJECTION_CLASS_KEYS,
  PROJECTION_CLASS_LABELS,
  type ProjectionClassKey,
  type ProjectionClassValues,
} from '../lib/projectionClasses';
import {
  HORIZONS,
  WINDOWS,
  classNumbers,
  emptyClassFields,
  flatLineNote,
  inputsToParams,
  projectionCacheKey,
  readInputs,
  scenarioFrameFromSearch,
  scenarioRequestFailure,
  type Inputs,
} from './projectionsView';

const SOURCE_LABEL: Record<ProjectionAssumption['source'], string> = {
  user_data: 'From your data',
  default: 'Default',
  query: 'You entered',
};

const CLASS_SOURCE_LABEL: Record<ProjectionAssetClass['returnSource'], string> = {
  ...SOURCE_LABEL,
  saved: 'Your saved default',
};

const CLASS_COLOURS: Record<ProjectionClassKey, string> = {
  cash: '#8b9aab',
  shares: '#7a5cc4',
  kiwiSaver: '#2a9d8f',
  crypto: '#e0a030',
  mining: '#b5651d',
  metals: '#a0a6ad',
  property: '#5c7cfa',
  other: '#c06c84',
};

function pctText(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}

/** Shown in the class fields when nothing is typed: what the projection is using. */
function usedReturnHint(c: ProjectionAssetClass | undefined): string {
  if (!c) return 'Default';
  return c.returnSource === 'saved' ? `${pctText(c.annualReturnPercent)} saved` : `${pctText(c.annualReturnPercent)}`;
}

function usedAddHint(c: ProjectionAssetClass | undefined): string {
  if (!c || c.monthlyAdditionNzd == null) return 'None';
  const v = `${c.monthlyAdditionNzd < 0 ? '−' : ''}$${Math.abs(Math.round(c.monthlyAdditionNzd))}`;
  return c.additionSource === 'saved' ? `${v} saved` : c.additionSource === 'user_data' ? `${v} (data)` : v;
}

function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function signedNzd(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatNzd(Math.abs(n))}`;
}

/** The API names its query parameter for values typed in the Scenario form; say it plainly. */
function reasonText(a: ProjectionAssumption): string | null {
  if (a.source !== 'query' || !a.reason) return a.reason;
  const rest = a.reason.replace(/^Taken from the \w+ query parameter\.\s*/, '');
  return `You entered this in Scenario above.${rest ? ` ${rest}` : ''}`;
}

function Assumption({ title, a, value }: { title: string; a: ProjectionAssumption; value: string }) {
  const reason = reasonText(a);
  return (
    <li>
      <div>
        <strong>{title}</strong> <span className="muted small">· {SOURCE_LABEL[a.source]}</span>
        {reason ? <div className="muted small">{reason}</div> : null}
      </div>
      <span className="money">{value}</span>
    </li>
  );
}

export function Projections() {
  const [params, setParams] = useSearchParams();
  const applied = useMemo(() => readInputs(params), [params]);
  const appliedKey = JSON.stringify(applied);
  // Same helper on the first paint and when the URL changes in place (the
  // Projections nav link). The form and the cached figures update together,
  // before paint, so a cached 1-year view cannot sit under the old scenario fields.
  const frame = scenarioFrameFromSearch(params, (key) => readPageCache<ProjectionResponse>(key));
  const [form, setForm] = useState<Inputs>(frame.form);
  const [data, setData] = useState<ProjectionResponse | null>(frame.data);
  const [error, setError] = useState<string | null>(null);
  // Loading until the response for the inputs currently in the URL has arrived.
  // A cache hit for this exact scenario counts as arrived, then refreshes quietly.
  const [loadedKey, setLoadedKey] = useState<string | null>(frame.loaded ? appliedKey : null);
  const [shownKey, setShownKey] = useState(appliedKey);
  if (shownKey !== appliedKey) {
    setShownKey(appliedKey);
    setForm(frame.form);
    setData(frame.data);
    setLoadedKey(frame.loaded ? appliedKey : null);
    setError(null);
  }
  const loading = loadedKey !== appliedKey;

  useEffect(() => {
    let cancelled = false;
    const key = projectionCacheKey(applied);
    const requestKey = JSON.stringify(applied);
    const stamp = beginPageRead(key);
    api.projections
      .get({
        months: applied.months,
        savingWindowMonths: applied.window,
        annualReturnPercent: applied.returnPct === '' ? undefined : Number(applied.returnPct),
        monthlySavingNzd: applied.saving === '' ? undefined : Number(applied.saving),
        classReturns: classNumbers(applied.classReturns),
        classAdds: classNumbers(applied.classAdds),
      })
      .then((r) => {
        if (cancelled) return;
        if (!commitPageRead(stamp, r)) return;
        setData(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const failure = scenarioRequestFailure(readPageCache<ProjectionResponse>(key) != null);
        if (failure.kind === 'keep-cache') {
          showQuietToast('Could not refresh projection — showing last data.', { kind: 'warn' });
          return;
        }
        setData(null);
        setError(err instanceof ApiError ? err.message : 'Projection could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [applied]);

  const onApply = (e: FormEvent) => {
    e.preventDefault();
    setParams(inputsToParams(form), { replace: true });
  };

  const onReset = () => {
    const base = { months: applied.months, window: 3, returnPct: '', saving: '', classReturns: emptyClassFields(), classAdds: emptyClassFields() };
    setForm(base);
    setParams(new URLSearchParams({ months: String(base.months) }), { replace: true });
  };

  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsMsg, setDefaultsMsg] = useState<string | null>(null);
  const classesByKey = useMemo(
    () => new Map((data?.assetClasses ?? []).map((c) => [c.key, c] as const)),
    [data],
  );

  /** Typed values win; classes left blank keep what is already saved. */
  const onSaveDefaults = async (forget = false) => {
    setSavingDefaults(true);
    setDefaultsMsg(null);
    try {
      const returns: ProjectionClassValues = {};
      const contributions: ProjectionClassValues = {};
      if (!forget) {
        for (const key of PROJECTION_CLASS_KEYS) {
          const c = classesByKey.get(key);
          const r = form.classReturns[key].trim();
          const a = form.classAdds[key].trim();
          if (r !== '') returns[key] = Number(r);
          else if (c?.returnSource === 'saved') returns[key] = c.annualReturnPercent;
          if (a !== '') contributions[key] = Number(a);
          else if (c?.additionSource === 'saved' && c.monthlyAdditionNzd != null) contributions[key] = c.monthlyAdditionNzd;
        }
      }
      await api.projections.saveAssumptions({ returns, contributions });
      // Saved values now apply without being in the link.
      const cleared = { ...form, classReturns: emptyClassFields(), classAdds: emptyClassFields() };
      setForm(cleared);
      setParams(inputsToParams(cleared), { replace: true });
      setLoadedKey(null);
      setDefaultsMsg(forget ? 'Saved rates cleared.' : 'Saved. These rates are used every time you open Projections.');
    } catch (err) {
      setDefaultsMsg(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setSavingDefaults(false);
    }
  };

  const series: LineSeries[] = useMemo(() => {
    if (!data) return [];
    // Beyond two years, one point a year keeps the lines readable (the table has every year).
    const pts = data.horizonMonths > 24
      ? data.points.filter((p) => p.monthIndex % 12 === 0 || p.monthIndex === data.horizonMonths)
      : data.points;
    const out: LineSeries[] = [
      { key: 'netWorth', label: 'Net worth', colour: '#3d9a6a', points: pts.map((p) => ({ at: p.date, value: p.netWorthNzd })) },
      { key: 'assets', label: 'Assets that grow', colour: '#4a8fd4', points: pts.map((p) => ({ at: p.date, value: p.compoundingAssetsNzd })) },
    ];
    for (const key of PROJECTION_CLASS_KEYS) {
      const c = data.assetClasses?.find((x) => x.key === key);
      if (!c || (Math.abs(c.startNzd) < 0.005 && Math.abs(c.endNzd) < 0.005)) continue;
      out.push({
        key: `class-${key}`,
        label: PROJECTION_CLASS_LABELS[key],
        colour: CLASS_COLOURS[key],
        points: pts.map((p) => ({ at: p.date, value: p.byClassNzd?.[key] ?? 0 })),
      });
    }
    if (pts.some((p) => p.debtOutstandingNzd > 0)) {
      out.push({ key: 'debt', label: 'Debt outstanding', colour: '#d45a7a', points: pts.map((p) => ({ at: p.date, value: p.debtOutstandingNzd })) });
    }
    if (pts.some((p) => p.savingsAddedNzd != null)) {
      out.push({
        key: 'saved',
        label: 'Savings added',
        colour: '#c47a2c',
        points: pts.filter((p) => p.savingsAddedNzd != null).map((p) => ({ at: p.date, value: p.savingsAddedNzd! })),
      });
    }
    return out;
  }, [data]);

  const start = data?.points[0];
  const end = data?.points.at(-1);
  const change = start && end ? end.netWorthNzd - start.netWorthNzd : 0;
  const flat = Boolean(data && start && end && Math.abs(change) < 0.005);
  const a = data?.assumptions;
  const savingValue = a?.monthlySavingNzd.value;
  const yearly = data?.points.filter((p) => p.monthIndex % 12 === 0 || p.monthIndex === data.horizonMonths) ?? [];

  return (
    <div className="stack projections-page">
      <section className="hero-card hero-card--centered">
        <h2 className="page-title">Projections</h2>
        <p className="page-lead">
          Where your net worth heads if today&apos;s balances, debt payments and saving carry on. Educational only —
          not a forecast of prices or financial advice. Change the return or saving below to try a scenario.
        </p>
      </section>

      <section className="panel" aria-label="Scenario">
        <h3>Scenario</h3>
        <form className="form-grid projection-form" onSubmit={onApply}>
          <label>
            Time ahead
            <select value={form.months} onChange={(e) => setForm({ ...form, months: Number(e.target.value) })}>
              {HORIZONS.map((h) => (
                <option key={h.months} value={h.months}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Default yearly return (%)
            <input
              type="number"
              step="0.1"
              min={-50}
              max={50}
              inputMode="decimal"
              placeholder="0 (default)"
              value={form.returnPct}
              onChange={(e) => setForm({ ...form, returnPct: e.target.value })}
            />
            <span className="muted small">For asset classes below without a return of their own.</span>
          </label>
          <label>
            Monthly saving (NZD)
            <input
              type="number"
              step="1"
              min={-10000000}
              max={10000000}
              inputMode="decimal"
              placeholder="From your budget"
              value={form.saving}
              onChange={(e) => setForm({ ...form, saving: e.target.value })}
            />
          </label>
          <label>
            Budget months to average
            <select value={form.window} onChange={(e) => setForm({ ...form, window: Number(e.target.value) })}>
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  Last {w} months
                </option>
              ))}
            </select>
          </label>
          <div className="span-2">
            <h4 style={{ margin: '0.5rem 0 0.25rem' }}>By asset class</h4>
            <p className="muted small" style={{ margin: 0 }}>
              Set an average yearly return and a monthly amount for each kind of asset. Blank fields use what the
              projection shows in grey: your saved default, your data, or the default return. Returns are your own
              assumptions — nothing here is a price forecast. Money moved to the <strong>Investments</strong> budget
              category counts as added to Shares &amp; funds and is taken out of cash, so it isn&apos;t counted twice.
              KiwiSaver contributions come out of pay. Mining rewards recorded as Mining income are already in your saving.
            </p>
            <div className="table-wrap" style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
              <table className="data-table projection-class-inputs">
                <thead>
                  <tr>
                    <th>Asset class</th>
                    <th style={{ textAlign: 'right' }}>Today</th>
                    <th>Yearly return (%)</th>
                    <th>Added each month (NZD)</th>
                  </tr>
                </thead>
                <tbody>
                  {PROJECTION_CLASS_KEYS.map((key) => {
                    const c = classesByKey.get(key);
                    return (
                      <tr key={key}>
                        <td>{PROJECTION_CLASS_LABELS[key]}</td>
                        <td className="money" style={{ textAlign: 'right' }}>{c ? formatNzd(c.startNzd) : '—'}</td>
                        <td>
                          <input
                            type="number"
                            step="0.1"
                            min={-50}
                            max={50}
                            inputMode="decimal"
                            aria-label={`${PROJECTION_CLASS_LABELS[key]} yearly return`}
                            placeholder={usedReturnHint(c)}
                            value={form.classReturns[key]}
                            onChange={(e) => setForm({ ...form, classReturns: { ...form.classReturns, [key]: e.target.value } })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="1"
                            min={-10000000}
                            max={10000000}
                            inputMode="decimal"
                            aria-label={`${PROJECTION_CLASS_LABELS[key]} added each month`}
                            placeholder={usedAddHint(c)}
                            value={form.classAdds[key]}
                            onChange={(e) => setForm({ ...form, classAdds: { ...form.classAdds, [key]: e.target.value } })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="span-2 row gap" style={{ flexWrap: 'wrap' }}>
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? 'Projecting…' : 'Update projection'}
            </button>
            <button type="button" className="btn ghost" onClick={onReset} disabled={loading}>
              Use my data only
            </button>
            <button type="button" className="btn" onClick={() => void onSaveDefaults()} disabled={loading || savingDefaults}>
              Save class rates as my defaults
            </button>
            {[...classesByKey.values()].some((c) => c.returnSource === 'saved' || c.additionSource === 'saved') ? (
              <button type="button" className="btn ghost" onClick={() => void onSaveDefaults(true)} disabled={loading || savingDefaults}>
                Forget saved rates
              </button>
            ) : null}
          </div>
          {defaultsMsg ? <p className="muted small span-2" role="status">{defaultsMsg}</p> : null}
        </form>
        {applied.ignored.length ? (
          <p className="muted small" role="status">
            Ignored from the link: {applied.ignored.join('; ')}.
          </p>
        ) : null}
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {!data && loading ? <p className="muted">Loading projection…</p> : null}

      {data && start && end ? (
        <>
          <section className="grid cards">
            <div className="card">
              <p className="eyebrow">Net worth today</p>
              <p className="stat-value">{formatNzd(start.netWorthNzd)}</p>
              <p className="muted small">As of {formatDate(data.asOf)}</p>
            </div>
            <div className="card">
              <p className="eyebrow">In {HORIZONS.find((h) => h.months === data.horizonMonths)?.label ?? `${data.horizonMonths} months`}</p>
              <p className="stat-value">{formatNzd(end.netWorthNzd)}</p>
              <p className="muted small">
                {signedNzd(change)} by {formatDate(end.date)}
              </p>
            </div>
            <div className="card">
              <p className="eyebrow">Monthly saving used</p>
              <p className="stat-value">{savingValue == null ? '—' : formatNzd(savingValue)}</p>
              <p className="muted small">{a ? SOURCE_LABEL[a.monthlySavingNzd.source] : ''}</p>
            </div>
            <div className="card">
              <p className="eyebrow">Investment growth</p>
              <p className="stat-value">
                {signedNzd((data.assetClasses ?? []).reduce((sum, c) => sum + c.growthNzd, 0))}
              </p>
              <p className="muted small">From each class&apos;s own return · compounded monthly</p>
            </div>
          </section>

          {flat ? (
            <p className="panel projection-flat" role="note">
              {flatLineNote({
                annualReturnPercent: a?.annualReturnPercent.value ?? null,
                compoundingAssetsNzd: data.starting.compoundingAssetsNzd,
                monthlySavingNzd: savingValue ?? null,
                debtHasSavedPayment: data.debts.some((d) => d.stepped),
              })}
            </p>
          ) : null}

          <section className="panel">
            <AssetLineChart
              series={series}
              title="Projected net worth (NZD)"
              emptyHint="Nothing to plot yet."
              resolution="month"
              fullWidth
              foregroundKey="netWorth"
            />
            <p className="muted small">{data.note}</p>
          </section>

          {data.assetClasses?.length ? (
            <section className="panel">
              <h3>By asset class</h3>
              <p className="section-desc">Each class grows on its own yearly return, plus what is added to it each month.</p>
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Asset class</th>
                      <th style={{ textAlign: 'right' }}>Today</th>
                      <th style={{ textAlign: 'right' }}>Return</th>
                      <th style={{ textAlign: 'right' }}>Added / month</th>
                      <th style={{ textAlign: 'right' }}>Growth</th>
                      <th style={{ textAlign: 'right' }}>At the end</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.assetClasses
                      .filter((c) => Math.abs(c.startNzd) >= 0.005 || Math.abs(c.endNzd) >= 0.005)
                      .map((c) => (
                        <tr key={c.key}>
                          <td>
                            {c.label}
                            {c.additionReason ? <div className="muted small">{c.additionReason}</div> : null}
                          </td>
                          <td className="money" style={{ textAlign: 'right' }}>{formatNzd(c.startNzd)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {pctText(c.annualReturnPercent)}
                            <div className="muted small">{CLASS_SOURCE_LABEL[c.returnSource]}</div>
                          </td>
                          <td className="money" style={{ textAlign: 'right' }}>
                            {c.monthlyAdditionNzd == null ? '—' : formatNzd(c.monthlyAdditionNzd)}
                            <div className="muted small">{CLASS_SOURCE_LABEL[c.additionSource]}</div>
                          </td>
                          <td className="money" style={{ textAlign: 'right' }}>{signedNzd(c.growthNzd)}</td>
                          <td className="money" style={{ textAlign: 'right' }}>{formatNzd(c.endNzd)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">Classes with nothing in them and nothing added are hidden. Set them in Scenario above.</p>
            </section>
          ) : null}

          <section className="panel">
            <h3>Assumptions</h3>
            <p className="section-desc">Where every number in this projection comes from.</p>
            {a ? (
              <ul className="security-list projection-assumptions">
                <Assumption title="Default yearly return (classes without their own)" a={a.annualReturnPercent} value={a.annualReturnPercent.value == null ? '—' : `${a.annualReturnPercent.value}%`} />
                <Assumption title="Monthly saving" a={a.monthlySavingNzd} value={savingValue == null ? '—' : formatNzd(savingValue)} />
                <Assumption title="KiwiSaver contributions" a={a.kiwiSaverContributionMonthlyNzd} value={a.kiwiSaverContributionMonthlyNzd.value == null ? '—' : `${formatNzd(a.kiwiSaverContributionMonthlyNzd.value)}/mo`} />
                <Assumption title="Inflation" a={a.inflationPercent} value={a.inflationPercent.value == null ? 'Not applied' : `${a.inflationPercent.value}%`} />
                <Assumption title="Dividends" a={a.dividends} value="In saving" />
                <Assumption title="Savings goals" a={a.savingsGoals} value="Not used" />
              </ul>
            ) : null}
            <p className="muted small">
              Budget months used: {a?.monthlySavingNzd.windowStart} to {a?.monthlySavingNzd.windowEnd} · income{' '}
              {a?.monthlySavingNzd.incomeNzd == null ? '—' : formatNzd(a.monthlySavingNzd.incomeNzd)} · spending{' '}
              {a?.monthlySavingNzd.spendingNzd == null ? '—' : formatNzd(a.monthlySavingNzd.spendingNzd)} ·{' '}
              {a?.monthlySavingNzd.monthsWithActivity ?? 0} month(s) with activity.
              {a?.monthlySavingNzd.expectedPayMonthlyNzd != null ? (
                <>
                  {' '}Saved pay sources: {formatNzd(a.monthlySavingNzd.expectedPayMonthlyNzd)}/mo
                  {a.monthlySavingNzd.usedExpectedPay ? ' (used, because no income is recorded in the window).' : ' (not used — recorded income is used instead).'}
                </>
              ) : null}
            </p>
          </section>

          {data.debts.length > 0 || data.propertyMortgage.balanceNzd > 0 || data.bankLiabilities.balanceNzd !== 0 ? (
            <section className="panel">
              <h3>Debts</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Debt</th>
                      <th>Today</th>
                      <th>At the end</th>
                      <th>Rate</th>
                      <th>Payment</th>
                      <th>How it&apos;s projected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.debts.map((d) => (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td className="money">{formatNzd(d.startingBalanceNzd)}</td>
                        <td className="money">{formatNzd(d.endingBalanceNzd)}</td>
                        <td className="muted small">
                          {d.annualRatePercent == null ? '—' : `${d.annualRatePercent}% / ${d.interestPeriod ?? 'year'}`}
                        </td>
                        <td className="money">{d.actualPaymentNzd == null ? '—' : `${formatNzd(d.actualPaymentNzd)}/mo`}</td>
                        <td className="muted small">
                          {d.reason ?? (d.paysDown === false ? 'Payment doesn’t cover interest — balance grows.' : 'Paid down monthly.')}
                        </td>
                      </tr>
                    ))}
                    {data.propertyMortgage.balanceNzd > 0 ? (
                      <tr>
                        <td>Property mortgage</td>
                        <td className="money">{formatNzd(data.propertyMortgage.balanceNzd)}</td>
                        <td className="money">{formatNzd(data.propertyMortgage.balanceNzd)}</td>
                        <td className="muted small">—</td>
                        <td className="money">—</td>
                        <td className="muted small">{data.propertyMortgage.reason}</td>
                      </tr>
                    ) : null}
                    {data.bankLiabilities.balanceNzd !== 0 ? (
                      <tr>
                        <td>Credit cards &amp; loans</td>
                        <td className="money">{formatNzd(data.bankLiabilities.balanceNzd)}</td>
                        <td className="money">{formatNzd(data.bankLiabilities.balanceNzd)}</td>
                        <td className="muted small">—</td>
                        <td className="money">—</td>
                        <td className="muted small">{data.bankLiabilities.reason}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="panel">
            <h3>Year by year</h3>
            <div className="table-wrap table-wrap--scroll" tabIndex={0} aria-label="Projection year by year">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Net worth</th>
                    <th>Assets</th>
                    <th>Savings added</th>
                    <th>Debt</th>
                  </tr>
                </thead>
                <tbody>
                  {yearly.map((p) => (
                    <tr key={p.date}>
                      <td className="muted small">{formatDate(p.date)}</td>
                      <td className="money">{formatNzd(p.netWorthNzd)}</td>
                      <td className="money">{formatNzd(p.compoundingAssetsNzd)}</td>
                      <td className="money">{p.savingsAddedNzd == null ? '—' : formatNzd(p.savingsAddedNzd)}</td>
                      <td className="money">{formatNzd(p.debtOutstandingNzd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="projection-formula">
              <summary className="muted small">How it&apos;s calculated</summary>
              <ul className="muted small">
                <li>Net worth = {data.formula.netWorth}</li>
                <li>Assets each month = {data.formula.compoundingAssets}</li>
                <li>Monthly saving = {data.formula.monthlySaving}</li>
                <li>Debt: {data.formula.debt}</li>
              </ul>
            </details>
          </section>
        </>
      ) : null}
    </div>
  );
}
