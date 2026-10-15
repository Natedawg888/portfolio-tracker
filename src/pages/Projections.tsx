/**
 * Projections (KAN-17): forward net worth and savings from GET /api/projections (PR #41).
 * Educational only — every figure comes from the user's balances, payments and cashflow,
 * plus the return / saving the user types in. The page renders the API; it does not project.
 * Inputs live in the URL (?months=&annualReturnPercent=&monthlySavingNzd=&savingWindowMonths=)
 * so a scenario can be bookmarked or shared.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api, formatNzd } from '../api/client';
import { AssetLineChart, type LineSeries } from '../components/AssetLineChart';
import { CompoundInterestCalculator } from '../components/CompoundInterestCalculator';
import { RetirementCalculator } from '../components/RetirementCalculator';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { showQuietToast } from '../lib/quietToast';
import type { ProjectionAssetClass, ProjectionAssumption, ProjectionMining, ProjectionResponse } from '../types';
import {
  PROJECTION_CLASS_KEYS,
  PROJECTION_CLASS_LABELS,
  type ProjectionClassKey,
  type MiningPlan,
  type ProjectionClassValues,
} from '../lib/projectionClasses';
import {
  HORIZONS,
  WINDOWS,
  additionsAreEven,
  budgetAverageInput,
  budgetAverageLabel,
  canUseBudgetAverage,
  classNumbers,
  emptyClassFields,
  emptyMiningFields,
  growthSliderMax,
  horizonPhrase,
  horizonPill,
  miningPlanFromFields,
  type MiningFields,
  flatLineNote,
  inputsToParams,
  projectionBreakdown,
  projectionCacheKey,
  projectionFigures,
  readInputs,
  sampleProjectionPoints,
  savingSliderBounds,
  scenarioFrameFromSearch,
  scenarioRequestFailure,
  sliderPercentLabel,
  todayPlusAddedPoints,
  typedOrInUse,
  yearlyIncreaseCaption,
  type Inputs,
} from './projectionsView';

const WITH_GROWTH = '#3d9a6a';
const TODAY_PLUS_ADDED = '#4a8fd4';
type ProjectionMode = 'worth' | 'compound' | 'retirement';

/** Keep a range input on its step so the thumb matches a real amount. */
function onSliderStep(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(value) || step <= 0) return min;
  const clamped = Math.min(max, Math.max(min, value));
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.round(Math.min(max, Math.max(min, snapped)) * 100) / 100;
}

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
  return `You entered this above.${rest ? ` ${rest}` : ''}`;
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

const MINING_INPUTS: Array<{ key: keyof MiningFields & string; label: string; step: string; hint: (m: ProjectionMining) => string }> = [
  { key: 'addThPerMonth', label: 'Add TH each month', step: '0.1', hint: () => '0' },
  { key: 'addThOnce', label: 'Add TH once (now)', step: '0.1', hint: () => '0' },
  { key: 'newThWth', label: 'W/TH of added TH', step: '0.1', hint: (m) => (m.inputs?.avgWth != null ? `${m.inputs.avgWth} (fleet avg)` : 'Fleet average') },
  { key: 'thPriceNzd', label: 'Price per TH (NZD)', step: '0.01', hint: () => 'Not set' },
  { key: 'wthDropPerMonth', label: 'Lower W/TH each month by', step: '0.1', hint: () => '0 (stops at 12)' },
  { key: 'upgradeCostPerMonthNzd', label: 'Upgrade cost each month (NZD)', step: '1', hint: () => '0' },
  { key: 'rewardChangePct', label: 'Yearly change in reward per TH (%)', step: '1', hint: () => '0' },
];

function MiningPlanFields({
  mining,
  fields,
  onChange,
}: {
  mining: ProjectionMining;
  fields: MiningFields;
  onChange: (next: MiningFields) => void;
}) {
  const inUse = mining.plan;
  return (
    <div className="span-2">
      <h4 style={{ margin: '0.75rem 0 0.25rem' }}>Mining (GoMining)</h4>
      <p className="muted small" style={{ margin: 0 }}>
        {mining.inputs
          ? `${mining.inputs.th.toLocaleString('en-NZ')} TH at ${mining.inputs.avgWth ?? '—'} W/TH. `
          : ''}
        Blank fields keep the plan already in use. Upgrades stop at 12 W/TH.
      </p>
      {mining.status === 'unavailable' ? <p className="banner" style={{ marginTop: '0.5rem' }}>{mining.reason}</p> : null}
      <div className="form-grid" style={{ marginTop: '0.5rem' }}>
        {MINING_INPUTS.map((f) => {
          const used = inUse[f.key as keyof typeof inUse];
          return (
            <label key={f.key}>
              {f.label}
              <input
                type="number"
                step={f.step}
                inputMode="decimal"
                placeholder={used != null && f.key !== 'rewardsTo' ? `${used} saved` : f.hint(mining)}
                value={fields[f.key]}
                onChange={(e) => onChange({ ...fields, [f.key]: e.target.value })}
              />
            </label>
          );
        })}
        <label>
          Rewards go to
          <select
            value={fields.rewardsTo}
            onChange={(e) => onChange({ ...fields, rewardsTo: e.target.value as MiningFields['rewardsTo'] })}
          >
            <option value="">{`In use: ${inUse.rewardsTo === 'reinvest' ? 'reinvest' : inUse.rewardsTo === 'cash' ? 'cash' : 'kept as BTC'}`}</option>
            <option value="crypto">Kept as BTC (Crypto)</option>
            <option value="cash">Sold to cash</option>
            <option value="reinvest">Reinvested into more TH</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function MiningResults({ mining, months }: { mining: ProjectionMining; months: number }) {
  const p = mining.projection;
  const years = months / 12;
  const yearly = p ? p.months.filter((m) => m.monthIndex % 12 === 0 || m.monthIndex === months) : [];
  return (
    <details className="proj-fold">
      <summary>Mining (GoMining)</summary>
      {!p ? (
        <p className="muted">{mining.reason ?? 'Mining rewards are not projected.'}</p>
      ) : (
        <>
          <div className="grid cards" style={{ marginTop: '0.5rem' }}>
            <div className="card">
              <p className="eyebrow">Reward now</p>
              <p className="stat-value">{formatNzd(p.start.monthlyNetNzd)}</p>
              <p className="muted small">a month · {p.start.monthlyNetBtc.toFixed(6)} BTC</p>
            </div>
            <div className="card">
              <p className="eyebrow">Reward in the last month</p>
              <p className="stat-value">{formatNzd(p.totals.lastMonthRewardNzd)}</p>
              <p className="muted small">{p.totals.endTh.toLocaleString('en-NZ', { maximumFractionDigits: 2 })} TH at {p.totals.endAvgWth ?? '—'} W/TH</p>
            </div>
            <div className="card">
              <p className="eyebrow">Rewards over {years >= 1 ? `${Math.round(years * 10) / 10} yr` : `${months} mo`}</p>
              <p className="stat-value">{formatNzd(p.totals.rewardNzd)}</p>
              <p className="muted small">{p.totals.rewardBtc.toFixed(6)} BTC</p>
            </div>
            <div className="card">
              <p className="eyebrow">Increase from your plan</p>
              <p className="stat-value">{signedNzd(p.totals.increaseNzd)}</p>
              <p className="muted small">vs {formatNzd(p.totals.baselineRewardNzd)} with no changes{p.totals.spendNzd > 0 ? ` · costs ${formatNzd(p.totals.spendNzd)}` : ''}</p>
            </div>
          </div>
          {yearly.length > 1 ? (
            <div className="table-wrap" style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th style={{ textAlign: 'right' }}>TH</th>
                    <th style={{ textAlign: 'right' }}>W/TH</th>
                    <th style={{ textAlign: 'right' }}>Net sat/TH/day</th>
                    <th style={{ textAlign: 'right' }}>Reward that month</th>
                  </tr>
                </thead>
                <tbody>
                  {yearly.map((m) => (
                    <tr key={m.monthIndex}>
                      <td>{m.monthIndex}</td>
                      <td style={{ textAlign: 'right' }}>{m.th.toLocaleString('en-NZ', { maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'right' }}>{m.avgWth ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{m.netSatPerThDay}</td>
                      <td className="money" style={{ textAlign: 'right' }}>{formatNzd(m.rewardNzd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <ul className="muted small" style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem' }}>
            <li>
              Rewards are {mining.plan.rewardsTo === 'reinvest' ? 'reinvested into more TH' : mining.plan.rewardsTo === 'cash' ? 'sold to cash' : 'kept as BTC (Crypto class)'}.
              TH bought and upgrades are paid from cash and add to the miner value.
            </li>
            {mining.inputs && mining.inputs.recordedMiningIncomeMonthlyNzd !== 0 ? (
              <li>
                {formatNzd(mining.inputs.recordedMiningIncomeMonthlyNzd)} a month of Mining income in your budget is taken off cash, because
                this model now projects those rewards.
              </li>
            ) : null}
            <li>
              Model, not a forecast: today&apos;s pool reward{mining.inputs?.rewardChangePctYear ? ` changing ${mining.inputs.rewardChangePctYear}% a year` : ' held flat'}; BTC
              price changing {mining.inputs?.btcPriceChangePctYear ?? 0}% a year (your Crypto return).
            </li>
            {p.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </details>
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
        classGrowth: classNumbers(applied.classGrowth),
        mining: miningPlanFromFields(applied.mining),
        additionGrowthPct: applied.addGrowth === '' ? undefined : Number(applied.addGrowth),
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

  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);
  const commitTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
  }, []);

  const commitNow = (patch: Partial<Inputs>) => {
    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    setParams(inputsToParams(next), { replace: true });
  };

  const commitSoon = (patch: Partial<Inputs>) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    if (commitTimer.current != null) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      setParams(inputsToParams(formRef.current), { replace: true });
    }, 350);
  };

  const onApply = (e: FormEvent) => {
    e.preventDefault();
    commitNow({});
  };

  const onReset = () => {
    commitNow({
      window: 3,
      returnPct: '',
      saving: '',
      classReturns: emptyClassFields(),
      classAdds: emptyClassFields(),
      classGrowth: emptyClassFields(),
      mining: emptyMiningFields(),
      addGrowth: '',
    });
  };

  const [mode, setMode] = useState<ProjectionMode>(() =>
    window.location.hash === '#retirement'
      ? 'retirement'
      : window.location.hash === '#calculators' || window.location.hash === '#compound-interest'
        ? 'compound'
        : 'worth',
  );
  const [fineOpen, setFineOpen] = useState(false);

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
      const growth: ProjectionClassValues = {};
      if (!forget) {
        for (const key of PROJECTION_CLASS_KEYS) {
          const c = classesByKey.get(key);
          const g = form.classGrowth[key].trim();
          if (g !== '') growth[key] = Number(g);
          else if (c?.growthSource === 'saved' && c.additionGrowthPercentYear != null) growth[key] = c.additionGrowthPercentYear;
          const r = form.classReturns[key].trim();
          const a = form.classAdds[key].trim();
          if (r !== '') returns[key] = Number(r);
          else if (c?.returnSource === 'saved') returns[key] = c.annualReturnPercent;
          if (a !== '') contributions[key] = Number(a);
          else if (c?.additionSource === 'saved' && c.monthlyAdditionNzd != null) contributions[key] = c.monthlyAdditionNzd;
        }
      }
      // Mining: the plan in use (saved + this scenario), with anything typed now on top.
      let mining: MiningPlan = {};
      if (!forget) {
        const inUse = data?.mining?.plan ?? {};
        mining = { ...inUse, ...miningPlanFromFields(form.mining) };
      }
      const typedGrowth = form.addGrowth.trim();
      const inUseGrowth = data?.additionGrowthPercentYear;
      const additionGrowthPct = forget
        ? undefined
        : typedGrowth !== ''
          ? Number(typedGrowth)
          : inUseGrowth && inUseGrowth.source !== 'default' && inUseGrowth.value
            ? inUseGrowth.value
            : undefined;
      await api.projections.saveAssumptions({ returns, contributions, mining, growth, ...(additionGrowthPct != null ? { additionGrowthPct } : {}) });
      // Saved values now apply without being in the link.
      const cleared = { ...form, classReturns: emptyClassFields(), classAdds: emptyClassFields(), classGrowth: emptyClassFields(), mining: emptyMiningFields(), addGrowth: '' };
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

  const figures = useMemo(() => {
    if (!data) return null;
    const endPoint = data.points.at(-1);
    return projectionFigures({
      startNetWorthNzd: data.points[0]?.netWorthNzd ?? null,
      endNetWorthNzd: endPoint?.netWorthNzd ?? null,
      classAddedNzd: data.assetClasses ? data.assetClasses.map((c) => c.addedNzd) : null,
      classGrowthNzd: data.assetClasses ? data.assetClasses.map((c) => c.growthNzd) : null,
      savingsAddedNzd: endPoint?.savingsAddedNzd ?? null,
      kiwiSaverAddedNzd: endPoint?.kiwiSaverContributionsAddedNzd ?? null,
    });
  }, [data]);

  const series: LineSeries[] = useMemo(() => {
    if (!data || !figures) return [];
    const pts = sampleProjectionPoints(data.points, data.horizonMonths);
    const out: LineSeries[] = [
      {
        key: 'withGrowth',
        label: 'With growth',
        colour: WITH_GROWTH,
        points: pts.map((p) => ({ at: p.date, value: p.netWorthNzd })),
      },
    ];
    const added = todayPlusAddedPoints(
      pts,
      figures.youAddNzd,
      additionsAreEven({
        defaultGrowthPercent: data.additionGrowthPercentYear?.value ?? null,
        classGrowthPercents: (data.assetClasses ?? []).map((c) => c.additionGrowthPercentYear),
        hasMonthlySchedule: data.mining?.projection != null,
      }),
    );
    if (added) {
      out.push({
        key: 'todayPlusAdded',
        label: 'Today plus what you add',
        colour: TODAY_PLUS_ADDED,
        dashed: true,
        points: added,
      });
    }
    return out;
  }, [data, figures]);

  const start = data?.points[0];
  const end = data?.points.at(-1);
  const change = start && end ? end.netWorthNzd - start.netWorthNzd : 0;
  const flat = Boolean(data && start && end && Math.abs(change) < 0.005);
  const a = data?.assumptions;
  const savingValue = a?.monthlySavingNzd.value;
  const observedSaving = a?.monthlySavingNzd.observedMonthlyNzd ?? null;
  const yearly = data?.points.filter((p) => p.monthIndex % 12 === 0 || p.monthIndex === data.horizonMonths) ?? [];
  const returnInUse = typedOrInUse(form.returnPct, a?.annualReturnPercent.value ?? null);
  const savingInUse = typedOrInUse(form.saving, savingValue ?? null);
  const growthInUse = typedOrInUse(form.addGrowth, data?.additionGrowthPercentYear?.value ?? null);
  const savingBounds = savingSliderBounds(savingInUse, observedSaving);
  const windowMonths = a?.monthlySavingNzd.windowMonths ?? form.window;
  const breakdown = projectionBreakdown(figures ?? { todayNzd: null, endNzd: null, youAddNzd: null, growthNzd: null }, (value) =>
    value == null ? '—' : formatNzd(value),
  );

  return (
    <div className="stack projections-page">
      <header className="proj-header">
        <div>
          <h2 className="page-title">Projections</h2>
          <p className="muted small proj-tagline">Your own assumptions played forward. Not a forecast or financial advice.</p>
        </div>
        <div className="segmented" role="group" aria-label="Projection mode">
          <button
            type="button"
            className={'segmented-btn' + (mode === 'worth' ? ' active' : '')}
            aria-pressed={mode === 'worth'}
            onClick={() => setMode('worth')}
          >
            My net worth
          </button>
          <button
            type="button"
            className={'segmented-btn' + (mode === 'compound' ? ' active' : '')}
            aria-pressed={mode === 'compound'}
            onClick={() => setMode('compound')}
          >
            Compound interest
          </button>
          <button
            type="button"
            className={'segmented-btn' + (mode === 'retirement' ? ' active' : '')}
            aria-pressed={mode === 'retirement'}
            onClick={() => setMode('retirement')}
          >
            Retirement
          </button>
        </div>
      </header>

      {mode === 'compound' ? (
        <CompoundInterestCalculator startingAmountNzd={data?.starting.compoundingAssetsNzd ?? null} />
      ) : mode === 'retirement' ? (
        <RetirementCalculator startingAmountNzd={data?.starting.compoundingAssetsNzd ?? null} />
      ) : (
        <>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <section className="panel proj-chart-card" aria-busy={loading} aria-label="Projected net worth">
            <div className="proj-chart-top">
              <div>
                <p className="proj-kicker">{data ? `Net worth in ${horizonPhrase(data.horizonMonths)}` : 'Net worth'}</p>
                <p className="proj-figure">{figures?.endNzd == null ? '—' : formatNzd(figures.endNzd)}</p>
                <p className="proj-breakdown">{data ? breakdown : 'Today — · you add — · growth —'}</p>
              </div>
              <div className="segmented segmented--small" role="group" aria-label="Time ahead">
                {HORIZONS.map((h) => (
                  <button
                    key={h.months}
                    type="button"
                    className={'segmented-btn' + (form.months === h.months ? ' active' : '')}
                    aria-pressed={form.months === h.months}
                    onClick={() => commitNow({ months: h.months })}
                  >
                    {horizonPill(h.months)}
                  </button>
                ))}
              </div>
            </div>
            {!data && loading ? <p className="muted">Loading projection…</p> : null}
            {data ? (
              <AssetLineChart
                series={series}
                title="Projected net worth"
                hideTitle
                emptyHint="Nothing to plot yet."
                resolution="month"
                fullWidth
                foregroundKey="withGrowth"
                markers={false}
                zeroBaseline
                moneyAxis
                height={300}
              />
            ) : null}
          </section>

          <section className="panel proj-scenario" aria-label="Try a scenario">
            <div className="proj-scenario-head">
              <h3>Try a scenario</h3>
              <button type="button" className="btn small ghost" onClick={onReset}>
                Reset
              </button>
            </div>
            <div className="proj-sliders">
              <div className="proj-slider">
                <label htmlFor="proj-return" className="proj-slider-label">
                  <span>Yearly return</span>
                  <strong>{sliderPercentLabel(returnInUse)}</strong>
                </label>
                <input
                  id="proj-return"
                  type="range"
                  min={-50}
                  max={50}
                  step={0.1}
                  aria-valuetext={sliderPercentLabel(returnInUse)}
                  disabled={!data}
                  value={returnInUse == null ? 0 : onSliderStep(returnInUse, -50, 50, 0.1)}
                  onChange={(e) => commitSoon({ returnPct: e.target.value })}
                />
                <p className="proj-slider-caption">For classes without their own rate</p>
              </div>
              <div className="proj-slider">
                <label htmlFor="proj-saving" className="proj-slider-label">
                  <span>Saving each month</span>
                  <strong>{savingInUse == null ? '—' : formatNzd(savingInUse)}</strong>
                </label>
                <input
                  id="proj-saving"
                  type="range"
                  min={savingBounds.min}
                  max={savingBounds.max}
                  step={savingBounds.step}
                  aria-valuetext={savingInUse == null ? 'Not set' : formatNzd(savingInUse)}
                  disabled={!data}
                  value={savingInUse == null ? savingBounds.min : onSliderStep(savingInUse, savingBounds.min, savingBounds.max, savingBounds.step)}
                  onChange={(e) => commitSoon({ saving: e.target.value })}
                />
                <p className="proj-slider-caption">
                  {budgetAverageLabel(windowMonths, observedSaving == null ? '—' : formatNzd(observedSaving))}
                  {canUseBudgetAverage(observedSaving) ? (
                    <>
                      {' · '}
                      <button type="button" className="proj-use-it" onClick={() => commitNow({ saving: budgetAverageInput(observedSaving as number) })}>
                        use it
                      </button>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="proj-slider">
                <label htmlFor="proj-growth" className="proj-slider-label">
                  <span>Saving goes up each year</span>
                  <strong>{sliderPercentLabel(growthInUse)}</strong>
                </label>
                <input
                  id="proj-growth"
                  type="range"
                  min={0}
                  max={growthSliderMax(growthInUse)}
                  step={1}
                  aria-valuetext={sliderPercentLabel(growthInUse)}
                  disabled={!data}
                  value={onSliderStep(growthInUse ?? 0, 0, growthSliderMax(growthInUse), 1)}
                  onChange={(e) => commitSoon({ addGrowth: e.target.value })}
                />
                <p className="proj-slider-caption">{yearlyIncreaseCaption(growthInUse)}</p>
              </div>
            </div>

            <button
              type="button"
              className="btn ghost proj-finetune"
              aria-expanded={fineOpen}
              aria-controls={fineOpen ? 'proj-finetune' : undefined}
              onClick={() => setFineOpen((open) => !open)}
            >
              Fine-tune by asset class <span aria-hidden="true">{fineOpen ? '▴' : '▾'}</span>
            </button>

            {fineOpen ? (
              <form id="proj-finetune" className="proj-finetune-body" onSubmit={onApply}>
                <label className="proj-window">
                  Budget months to average
                  <select value={form.window} onChange={(e) => commitNow({ window: Number(e.target.value) })}>
                    {WINDOWS.map((w) => (
                      <option key={w} value={w}>
                        Last {w} months
                      </option>
                    ))}
                  </select>
                </label>
                <div className="table-wrap" style={{ overflowX: 'auto' }}>
                  <table className="data-table projection-class-inputs">
                    <thead>
                      <tr>
                        <th>Asset class</th>
                        <th style={{ textAlign: 'right' }}>Today</th>
                        <th>Yearly return (%)</th>
                        <th>Added each month (NZD)</th>
                        <th>Increase each year (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PROJECTION_CLASS_KEYS.map((key) => {
                        const c = classesByKey.get(key);
                        return (
                          <tr key={key}>
                            <td>
                              <span className="proj-class-swatch" style={{ background: CLASS_COLOURS[key] }} aria-hidden />
                              {PROJECTION_CLASS_LABELS[key]}
                            </td>
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
                            <td>
                              <input
                                type="number"
                                step="1"
                                min={0}
                                max={500}
                                inputMode="decimal"
                                aria-label={`${PROJECTION_CLASS_LABELS[key]} increase each year`}
                                placeholder={
                                  c?.additionGrowthPercentYear == null
                                    ? 'Default'
                                    : `${c.additionGrowthPercentYear}%${c.growthSource === 'saved' ? ' saved' : c.growthSource === 'query' ? '' : ' (default)'}`
                                }
                                value={form.classGrowth[key]}
                                onChange={(e) => setForm({ ...form, classGrowth: { ...form.classGrowth, [key]: e.target.value } })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {data?.mining && data.mining.status !== 'no_miners' ? (
                  <MiningPlanFields
                    mining={data.mining}
                    fields={form.mining}
                    onChange={(mining) => setForm({ ...form, mining })}
                  />
                ) : null}
                <div className="row gap" style={{ flexWrap: 'wrap' }}>
                  <button type="submit" className="btn primary" disabled={loading}>
                    {loading ? 'Projecting…' : 'Apply'}
                  </button>
                  <button type="button" className="btn" onClick={() => void onSaveDefaults()} disabled={loading || savingDefaults}>
                    Save as my defaults
                  </button>
                  {[...classesByKey.values()].some((c) => c.returnSource === 'saved' || c.additionSource === 'saved' || c.growthSource === 'saved') ||
                  data?.additionGrowthPercentYear?.source === 'saved' ||
                  Object.keys(data?.mining?.plan ?? {}).some((k) => k !== 'rewardsTo') ? (
                    <button type="button" className="btn ghost" onClick={() => void onSaveDefaults(true)} disabled={loading || savingDefaults}>
                      Forget saved rates
                    </button>
                  ) : null}
                </div>
                {defaultsMsg ? <p className="muted small" role="status">{defaultsMsg}</p> : null}
              </form>
            ) : null}
            {applied.ignored.length ? (
              <p className="muted small" role="status">
                Ignored from the link: {applied.ignored.join('; ')}.
              </p>
            ) : null}
          </section>

          {data && start && end ? (
            <div className="proj-more">
              {data.assetClasses?.some((c) => Math.abs(c.startNzd) >= 0.005 || Math.abs(c.endNzd) >= 0.005) ? (
                <details className="proj-fold">
                  <summary>By asset class</summary>
                  <div className="table-wrap" style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Asset class</th>
                          <th style={{ textAlign: 'right' }}>Today</th>
                          <th style={{ textAlign: 'right' }}>Return</th>
                          <th style={{ textAlign: 'right' }}>Added / month</th>
                          <th style={{ textAlign: 'right' }}>Increase / yr</th>
                          <th style={{ textAlign: 'right' }}>Added in total</th>
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
                                <span className="proj-class-swatch" style={{ background: CLASS_COLOURS[c.key] }} aria-hidden />
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
                              <td style={{ textAlign: 'right' }}>
                                {pctText(c.additionGrowthPercentYear ?? 0)}
                                {c.growthSource ? <div className="muted small">{CLASS_SOURCE_LABEL[c.growthSource]}</div> : null}
                              </td>
                              <td className="money" style={{ textAlign: 'right' }}>{signedNzd(c.addedNzd)}</td>
                              <td className="money" style={{ textAlign: 'right' }}>{signedNzd(c.growthNzd)}</td>
                              <td className="money" style={{ textAlign: 'right' }}>{formatNzd(c.endNzd)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}

              {data.mining && data.mining.status !== 'no_miners' ? <MiningResults mining={data.mining} months={data.horizonMonths} /> : null}

              <details className="proj-fold">
                <summary>Assumptions</summary>
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
                {flat && a ? (
                  <p className="projection-flat" role="note">
                    {flatLineNote({
                      annualReturnPercent: a.annualReturnPercent.value,
                      compoundingAssetsNzd: data.starting.compoundingAssetsNzd,
                      monthlySavingNzd: savingValue ?? null,
                      debtHasSavedPayment: data.debts.some((d) => d.stepped),
                    })}
                  </p>
                ) : null}
                <p className="muted small">{data.note}</p>
              </details>

              {data.debts.length > 0 || data.propertyMortgage.balanceNzd > 0 || data.bankLiabilities.balanceNzd !== 0 ? (
                <details className="proj-fold">
                  <summary>Debts</summary>
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
                </details>
              ) : null}

              <details className="proj-fold">
                <summary>Year by year</summary>
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
              </details>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
