/**
 * Historical asset behaviour by calculated phase, only where a stored series
 * supports it. Nothing here is inferred from today's indicators and nothing is
 * filled in when a series is missing.
 *
 * Shares: the OECD share-price index three-month change. Quarter-end months give
 * non-overlapping quarterly changes, which chain into a quarter-end price index.
 * Cash: the interbank rate, and that rate minus annual CPI inflation.
 * Property, bonds, gold, and crypto have no long history in this app.
 */
import type { Analysis } from './analyse.ts';
import { median } from './insights.ts';
import { periodEnd } from './periods.ts';
import type { EconomicObservation, Phase } from './types.ts';
import { PHASE_CYCLE_ORDER, PHASE_LABEL } from './weights.ts';

export const ASSET_EXPLORER_IDS = ['shares', 'property', 'bonds', 'cash', 'gold', 'crypto'] as const;
export type AssetExplorerId = (typeof ASSET_EXPLORER_IDS)[number];

/** Fewer quarters than this and a per-phase figure is withheld. */
export const MIN_QUARTERS = 4;

export type PhaseStat = {
  phase: Phase;
  label: string;
  quarters: number;
  /** null when quarters < MIN_QUARTERS. */
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** Share of quarters above zero, 0–100. */
  positiveShare: number | null;
  /** Standard deviation of quarterly values. */
  volatility: number | null;
};

export type Drawdown = {
  peakPeriod: string;
  troughPeriod: string;
  /** Percent fall from peak to trough, negative. */
  depth: number;
  /** Quarter the previous peak was regained, or null if not yet. */
  recoveredPeriod: string | null;
  /** Quarters from trough back to the previous peak. */
  recoveryQuarters: number | null;
  peakPhase: Phase | null;
  troughPhase: Phase | null;
};

export type AssetMetric = {
  id: string;
  label: string;
  unit: '%' | 'pp' | '% p.a.';
  byPhase: PhaseStat[];
};

export type AssetEvidence = {
  id: AssetExplorerId;
  label: string;
  status: 'available' | 'unavailable';
  dataset: string | null;
  coverage: { from: string; to: string; quarters: number } | null;
  metrics: AssetMetric[];
  drawdowns: Drawdown[];
  includes: string[];
  excludes: string[];
  caveats: string[];
  /** For unavailable classes: what data would be needed. */
  requires: string | null;
  relatedIndicators: string[];
};

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function stats(phase: Phase, values: number[]): PhaseStat {
  const enough = values.length >= MIN_QUARTERS;
  const mean = values.length > 0 ? values.reduce((s, n) => s + n, 0) / values.length : null;
  const variance =
    values.length > 1 && mean != null
      ? values.reduce((s, n) => s + (n - mean) ** 2, 0) / (values.length - 1)
      : null;
  return {
    phase,
    label: PHASE_LABEL[phase],
    quarters: values.length,
    median: enough ? round(median(values)!) : null,
    mean: enough && mean != null ? round(mean) : null,
    min: enough ? round(Math.min(...values)) : null,
    max: enough ? round(Math.max(...values)) : null,
    positiveShare: enough ? Math.round((100 * values.filter((n) => n > 0).length) / values.length) : null,
    volatility: enough && variance != null ? round(Math.sqrt(variance)) : null,
  };
}

function nextQuarter(period: string): string | null {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const q = Number(m[2]);
  return q === 4 ? `${Number(m[1]) + 1}-Q1` : `${m[1]}-Q${q + 1}`;
}

function previousQuarter(period: string): string | null {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const q = Number(m[2]);
  return q === 1 ? `${Number(m[1]) - 1}-Q4` : `${m[1]}-Q${q - 1}`;
}

/** 2024-Q3 → 2024-07-01 */
function quarterStart(quarter: string): string | null {
  const m = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2]) * 3 - 2).padStart(2, '0')}-01`;
}

function latestOnOrBefore(rows: EconomicObservation[], end: string): EconomicObservation | null {
  let best: EconomicObservation | null = null;
  for (const row of rows) {
    if (row.periodEnd > end) continue;
    if (!best || row.periodEnd > best.periodEnd) best = row;
  }
  return best;
}

/** Quarter → share-price change over that quarter, from the quarter-end month's three-month change. */
export function quarterlyShareChanges(rows: EconomicObservation[]): Map<string, number> {
  const byMonth = new Map<string, number>();
  for (const row of rows) {
    if (row.frequency !== 'monthly') continue;
    byMonth.set(row.period, row.value);
  }
  const out = new Map<string, number>();
  for (const [month, value] of byMonth) {
    const m = month.match(/^(\d{4})-(\d{2})$/);
    if (!m) continue;
    const mm = Number(m[2]);
    if (mm % 3 !== 0) continue;
    out.set(`${m[1]}-Q${mm / 3}`, value);
  }
  return out;
}

/**
 * Peak-to-trough falls of at least `minDepth` percent on a quarter-end index
 * chained from quarterly changes. Stops at the first gap in the quarters.
 */
export function drawdownsFrom(
  quarters: Array<{ period: string; change: number }>,
  phaseOf: (period: string) => Phase | null,
  minDepth = 10,
): Drawdown[] {
  const out: Drawdown[] = [];
  let level = 100;
  // The index starts at 100 at the end of the quarter before the first change.
  let peak = { period: previousQuarter(quarters[0]?.period ?? '') ?? quarters[0]?.period ?? '', level: 100 };
  let trough: { period: string; level: number } | null = null;
  let previous: string | null = null;
  for (const row of quarters) {
    if (previous != null && nextQuarter(previous) !== row.period) break;
    previous = row.period;
    level *= 1 + row.change / 100;
    if (level >= peak.level) {
      if (trough) {
        const depth = (trough.level / peak.level - 1) * 100;
        if (depth <= -minDepth) {
          out.push({
            peakPeriod: peak.period,
            troughPeriod: trough.period,
            depth: round(depth, 1),
            recoveredPeriod: row.period,
            recoveryQuarters: quarterDistance(trough.period, row.period),
            peakPhase: phaseOf(peak.period),
            troughPhase: phaseOf(trough.period),
          });
        }
        trough = null;
      }
      peak = { period: row.period, level };
    } else if (!trough || level < trough.level) {
      trough = { period: row.period, level };
    }
  }
  if (trough) {
    const depth = (trough.level / peak.level - 1) * 100;
    if (depth <= -minDepth) {
      out.push({
        peakPeriod: peak.period,
        troughPeriod: trough.period,
        depth: round(depth, 1),
        recoveredPeriod: null,
        recoveryQuarters: null,
        peakPhase: phaseOf(peak.period),
        troughPhase: phaseOf(trough.period),
      });
    }
  }
  return out;
}

function quarterDistance(from: string, to: string): number {
  const a = from.match(/^(\d{4})-Q([1-4])$/);
  const b = to.match(/^(\d{4})-Q([1-4])$/);
  if (!a || !b) return 0;
  return Number(b[1]) * 4 + Number(b[2]) - (Number(a[1]) * 4 + Number(a[2]));
}

function unavailable(
  id: AssetExplorerId,
  label: string,
  requires: string,
  relatedIndicators: string[],
  caveats: string[] = [],
): AssetEvidence {
  return {
    id,
    label,
    status: 'unavailable',
    dataset: null,
    coverage: null,
    metrics: [],
    drawdowns: [],
    includes: [],
    excludes: [],
    caveats,
    requires,
    relatedIndicators,
  };
}

export function buildAssetEvidence(
  analysis: Pick<Analysis, 'timeline' | 'byType'>,
  countryName: string,
): AssetEvidence[] {
  const phaseByPeriod = new Map<string, Phase>();
  for (const point of analysis.timeline) if (point.phase) phaseByPeriod.set(point.period, point.phase);
  const phaseOf = (period: string) => phaseByPeriod.get(period) ?? null;
  const scoredQuarters = analysis.timeline.filter((point) => point.phase != null).map((point) => point.period);

  // Shares -----------------------------------------------------------------
  const shareRows = analysis.byType.get('share_market') ?? [];
  const shareByQuarter = quarterlyShareChanges(shareRows);
  const sharesNext: Record<Phase, number[]> = { recovery: [], expansion: [], late_expansion: [], slowdown: [], recession: [] };
  for (const period of scoredQuarters) {
    const next = nextQuarter(period);
    const change = next ? shareByQuarter.get(next) : undefined;
    if (change == null) continue;
    sharesNext[phaseByPeriod.get(period)!].push(change);
  }
  const shareQuarters = [...shareByQuarter.entries()]
    .map(([period, change]) => ({ period, change }))
    .filter((row) => scoredQuarters.length === 0 || row.period >= scoredQuarters[0]!)
    .sort((a, b) => (a.period < b.period ? -1 : 1));
  const sharesSample = Object.values(sharesNext).reduce((s, list) => s + list.length, 0);
  const shareSource = shareRows[0]?.source ?? 'OECD share price index';

  const shares: AssetEvidence =
    sharesSample === 0
      ? unavailable(
          'shares',
          'Shares',
          'The share-price series has no quarter-end observations that line up with calculated phases.',
          ['Share market'],
        )
      : {
          id: 'shares',
          label: 'Shares',
          status: 'available',
          dataset: `${shareSource} (${countryName}), quarter-end three-month change`,
          coverage: {
            from: shareQuarters[0]!.period,
            to: shareQuarters.at(-1)!.period,
            quarters: shareQuarters.length,
          },
          metrics: [
            {
              id: 'next_quarter_change',
              label: 'Price change in the following quarter',
              unit: '%',
              byPhase: PHASE_CYCLE_ORDER.map((phase) => stats(phase, sharesNext[phase])),
            },
          ],
          drawdowns: drawdownsFrom(shareQuarters, phaseOf),
          includes: ['Share-price index level changes'],
          excludes: ['Dividends', 'Fees', 'Tax', 'Inflation adjustment', 'Currency effects for offshore investors'],
          caveats: [
            'Price index only. Total returns including dividends would be higher.',
            'Figures follow each calculated quarter, so they show what happened next. The share index is also one of the inputs to the phase, so the two are not independent.',
            'Drawdowns use quarter-end levels of a monthly index. Falls within a quarter are not captured, so real peak-to-trough falls were deeper.',
            'Latest-vintage replay. Phases were not necessarily recognisable at the time.',
            `Medians are withheld when a phase has fewer than ${MIN_QUARTERS} quarters.`,
          ],
          requires: null,
          relatedIndicators: ['Share market', 'Yield curve', 'Interest rates'],
        };

  // Cash -------------------------------------------------------------------
  const rateRows = analysis.byType.get('interest_rates') ?? [];
  const cpiRows = analysis.byType.get('inflation_cpi') ?? [];
  const nominal: Record<Phase, number[]> = { recovery: [], expansion: [], late_expansion: [], slowdown: [], recession: [] };
  const real: Record<Phase, number[]> = { recovery: [], expansion: [], late_expansion: [], slowdown: [], recession: [] };
  const cashQuarters: string[] = [];
  for (const period of scoredQuarters) {
    const end = periodEnd(period);
    if (!end) continue;
    const start = quarterStart(period);
    const rate = latestOnOrBefore(rateRows, end);
    // Only a reading that falls inside the quarter counts; an older print is not carried forward.
    if (!rate || !start || rate.periodEnd < start) continue;
    const phase = phaseByPeriod.get(period)!;
    nominal[phase].push(rate.value);
    cashQuarters.push(period);
    const cpi = latestOnOrBefore(cpiRows, end);
    if (cpi && cpi.periodEnd >= start) real[phase].push(rate.value - cpi.value);
  }
  const cash: AssetEvidence =
    cashQuarters.length === 0
      ? unavailable('cash', 'Cash & term deposits', 'No short-term interest-rate observations line up with calculated phases.', [
          'Interest rates',
          'Inflation (CPI)',
        ])
      : {
          id: 'cash',
          label: 'Cash & term deposits',
          status: 'available',
          dataset: `${rateRows[0]?.source ?? 'Short-term interest rate'} (${countryName}), at each quarter end`,
          coverage: { from: cashQuarters[0]!, to: cashQuarters.at(-1)!, quarters: cashQuarters.length },
          metrics: [
            {
              id: 'nominal_rate',
              label: 'Short-term rate during the phase',
              unit: '% p.a.',
              byPhase: PHASE_CYCLE_ORDER.map((phase) => stats(phase, nominal[phase])),
            },
            {
              id: 'real_rate',
              label: 'Rate minus annual CPI inflation',
              unit: 'pp',
              byPhase: PHASE_CYCLE_ORDER.map((phase) => stats(phase, real[phase])),
            },
          ],
          drawdowns: [],
          includes: ['Wholesale short-term interest rate', 'Annual CPI inflation for the real figure'],
          excludes: ['Bank margins (retail term-deposit rates differ)', 'Resident withholding tax', 'Fees', 'Deposit-guarantee limits'],
          caveats: [
            'This is an interbank rate, not a bank term-deposit rate and not the central bank policy rate. Retail rates usually sit below it.',
            'The real figure subtracts annual inflation from a rate per annum. It is an approximation, before tax.',
            'Nominal cash does not fall in value; drawdowns do not apply. Inflation can still erode purchasing power.',
            `Medians are withheld when a phase has fewer than ${MIN_QUARTERS} quarters.`,
          ],
          requires: null,
          relatedIndicators: ['Interest rates', 'Inflation (CPI)', 'Yield curve'],
        };

  return [
    shares,
    unavailable(
      'property',
      'Residential property',
      'A house-price index with a long quarterly history (for New Zealand, the REINZ House Price Index or Stats NZ / CoreLogic series). Housing activity here counts dwelling consents, which is not a price or a return.',
      ['Housing activity', 'Interest rates', 'Credit conditions'],
    ),
    unavailable(
      'bonds',
      'Bonds',
      'A government bond total-return index (for example S&P/NZX NZ Government Bond Index) or a long history of bond yields and durations.',
      ['Interest rates', 'Yield curve', 'Inflation (CPI)'],
    ),
    cash,
    unavailable(
      'gold',
      'Gold & precious metals',
      'A monthly NZD gold price back to at least 2012. The app keeps up to one year of metal prices for portfolio cards, which is too short to span several phases.',
      ['Inflation (CPI)', 'Interest rates'],
    ),
    unavailable(
      'crypto',
      'Cryptocurrency',
      'A long daily or monthly price history. The app keeps up to one year of crypto prices. Bitcoin’s price history also covers few full cycles in this model, so any per-phase figure would rest on very few quarters.',
      ['Share market', 'Interest rates'],
      ['Crypto prices have not been shown to follow domestic economic phases in a stable way.'],
    ),
  ];
}
