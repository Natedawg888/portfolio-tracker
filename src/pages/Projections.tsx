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
import type { ProjectionAssumption, ProjectionResponse } from '../types';

const HORIZONS: Array<{ months: number; label: string }> = [
  { months: 12, label: '1 year' },
  { months: 24, label: '2 years' },
  { months: 60, label: '5 years' },
  { months: 120, label: '10 years' },
  { months: 240, label: '20 years' },
  { months: 360, label: '30 years' },
];
const WINDOWS = [3, 6, 12];

const SOURCE_LABEL: Record<ProjectionAssumption['source'], string> = {
  user_data: 'From your data',
  default: 'Default',
  query: 'You entered',
};

type Inputs = { months: number; window: number; returnPct: string; saving: string };

/** One cache entry per URL scenario, so a saved scenario cannot paint over a different link. */
function projectionCacheKey(input: Inputs): string {
  return `projections:${input.months}:${input.window}:${encodeURIComponent(input.returnPct)}:${encodeURIComponent(input.saving)}`;
}

/** Same limits the API enforces (server/projections/model.ts). */
const RETURN_RANGE = [-50, 50] as const;
const SAVING_LIMIT = 10_000_000;

function inRange(raw: string, min: number, max: number): boolean {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) && n >= min && n <= max;
}

/** URL → inputs. Out-of-range values (e.g. a hand-edited link) are dropped and reported. */
function readInputs(params: URLSearchParams): Inputs & { ignored: string[] } {
  const months = Number(params.get('months'));
  const window = Number(params.get('savingWindowMonths'));
  const ignored: string[] = [];
  let returnPct = params.get('annualReturnPercent') ?? '';
  if (returnPct !== '' && !inRange(returnPct, RETURN_RANGE[0], RETURN_RANGE[1])) {
    ignored.push(`yearly return must be between ${RETURN_RANGE[0]}% and ${RETURN_RANGE[1]}%`);
    returnPct = '';
  }
  let saving = params.get('monthlySavingNzd') ?? '';
  if (saving !== '' && !inRange(saving, -SAVING_LIMIT, SAVING_LIMIT)) {
    ignored.push('monthly saving must be a number up to $10,000,000');
    saving = '';
  }
  return {
    months: HORIZONS.some((h) => h.months === months) ? months : 12,
    window: WINDOWS.includes(window) ? window : 3,
    returnPct,
    saving,
    ignored,
  };
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
  const [form, setForm] = useState<Inputs>(applied);
  const appliedKey = JSON.stringify(applied);
  const cacheKey = projectionCacheKey(applied);
  const initialCached = readPageCache<ProjectionResponse>(cacheKey) ?? null;
  const [data, setData] = useState<ProjectionResponse | null>(initialCached);
  const [error, setError] = useState<string | null>(null);
  // Loading until the response for the inputs currently in the URL has arrived.
  // A cache hit for this exact scenario counts as arrived, then refreshes quietly.
  const [loadedKey, setLoadedKey] = useState<string | null>(initialCached ? appliedKey : null);
  const [shownKey, setShownKey] = useState(appliedKey);
  if (shownKey !== appliedKey) {
    setShownKey(appliedKey);
    const next = readPageCache<ProjectionResponse>(cacheKey);
    if (next) {
      setData(next);
      setLoadedKey(appliedKey);
      setError(null);
    } else {
      setLoadedKey(null);
    }
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
      })
      .then((r) => {
        if (cancelled) return;
        if (!commitPageRead(stamp, r)) return;
        setData(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (readPageCache<ProjectionResponse>(key)) {
          showQuietToast('Could not refresh projection — showing last data.', { kind: 'warn' });
          return;
        }
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
    const next = new URLSearchParams();
    next.set('months', String(form.months));
    if (form.window !== 3) next.set('savingWindowMonths', String(form.window));
    if (form.returnPct.trim() !== '') next.set('annualReturnPercent', form.returnPct.trim());
    if (form.saving.trim() !== '') next.set('monthlySavingNzd', form.saving.trim());
    setParams(next, { replace: true });
  };

  const onReset = () => {
    const base = { months: applied.months, window: 3, returnPct: '', saving: '' };
    setForm(base);
    setParams(new URLSearchParams({ months: String(base.months) }), { replace: true });
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
            Yearly return on assets (%)
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
          <div className="span-2 row gap">
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? 'Projecting…' : 'Update projection'}
            </button>
            <button type="button" className="btn ghost" onClick={onReset} disabled={loading}>
              Use my data only
            </button>
          </div>
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
              <p className="eyebrow">Yearly return used</p>
              <p className="stat-value">{a?.annualReturnPercent.value == null ? '—' : `${a.annualReturnPercent.value}%`}</p>
              <p className="muted small">{a ? SOURCE_LABEL[a.annualReturnPercent.source] : ''} · compounded monthly</p>
            </div>
          </section>

          {flat ? (
            <p className="panel projection-flat" role="note">
              The line is flat because nothing in this scenario changes your balances: the return is 0% and
              {savingValue == null ? ' there is no saving figure (no income or spending recorded in the budget months)' : ' saving is zero'}
              {data.debts.some((d) => d.stepped) ? '' : ', and no debt has a saved payment'}. Enter a yearly return or a
              monthly saving above to see a scenario.
            </p>
          ) : null}

          <section className="panel">
            <AssetLineChart
              series={series}
              title="Projected net worth (NZD)"
              emptyHint="Nothing to plot yet."
              resolution="month"
              fullWidth
            />
            <p className="muted small">{data.note}</p>
          </section>

          <section className="panel">
            <h3>Assumptions</h3>
            <p className="section-desc">Where every number in this projection comes from.</p>
            {a ? (
              <ul className="security-list projection-assumptions">
                <Assumption title="Yearly return on assets" a={a.annualReturnPercent} value={a.annualReturnPercent.value == null ? '—' : `${a.annualReturnPercent.value}%`} />
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
