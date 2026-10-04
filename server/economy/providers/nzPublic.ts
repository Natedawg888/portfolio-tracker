/**
 * New Zealand observations from public Stats NZ files and OECD SDMX.
 * A failed series is omitted. It is never replaced with a made-up number.
 */
import type { EconomicObservation } from '../types.ts';
import type { WithPrevious } from './derive.ts';
import { toObservations } from './observe.ts';
import {
  loadOecdCallRate,
  loadOecdCpi,
  loadOecdShareChange,
  loadOecdUnemployment,
  loadOecdYieldSpread,
  OECD_URLS,
} from './oecd.ts';
import {
  fetchCatalog,
  fetchReleaseDate,
  loadEmploymentGrowth,
  loadStatsSeries,
  releasePageUrl,
  selectStatsDocs,
  STATS_SERIES,
  type CatalogDoc,
} from './statsNz.ts';
import type { ProviderFetchResult } from './types.ts';

const PROVIDER_ID = 'nz-public';
const COUNTRY = 'NZ';

async function safe<T>(label: string, warnings: string[], task: () => Promise<T>): Promise<T | null> {
  try {
    return await task();
  } catch (err) {
    warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function published(releaseDate: string | null, fallbackEnd: string): { at: string; precision: 'release' | 'period_end' } {
  if (releaseDate) return { at: releaseDate, precision: 'release' };
  return { at: fallbackEnd, precision: 'period_end' };
}

export async function fetchNzPublic(): Promise<ProviderFetchResult> {
  const retrievedAt = new Date().toISOString();
  const warnings: string[] = [];
  const observations: EconomicObservation[] = [];

  const catalog = await safe('Stats NZ catalogue', warnings, fetchCatalog);
  const docs = catalog ? selectStatsDocs(catalog) : null;

  const [gdp, cpiFile, retail, jobs, oecdCpi, unemployment, callRate, yieldSpread, shares, releaseDates] =
    await Promise.all([
      docs?.gdp
        ? safe('Stats NZ GDP', warnings, () => loadStatsSeries(docs.gdp!, STATS_SERIES.gdp, 'quarterly'))
        : Promise.resolve(null),
      docs?.cpi
        ? safe('Stats NZ CPI', warnings, () => loadStatsSeries(docs.cpi!, STATS_SERIES.cpi, 'quarterly'))
        : Promise.resolve(null),
      docs?.retail
        ? safe('Stats NZ retail', warnings, () => loadStatsSeries(docs.retail!, STATS_SERIES.retail, 'quarterly'))
        : Promise.resolve(null),
      docs?.employment
        ? safe('Stats NZ employment', warnings, () => loadEmploymentGrowth(docs.employment!))
        : Promise.resolve(null),
      safe('OECD CPI', warnings, loadOecdCpi),
      safe('OECD unemployment', warnings, loadOecdUnemployment),
      safe('OECD interest rates', warnings, loadOecdCallRate),
      safe('OECD yield curve', warnings, loadOecdYieldSpread),
      safe('OECD share prices', warnings, loadOecdShareChange),
      releaseDatesFor(docs, warnings),
    ]);

  if (!docs?.gdp) warnings.push('Stats NZ GDP file was not found in the catalogue.');
  if (!docs?.cpi) warnings.push('Stats NZ CPI file was not found in the catalogue.');
  if (!docs?.retail) warnings.push('Stats NZ retail trade file was not found in the catalogue.');
  if (!docs?.employment) warnings.push('Stats NZ employment indicators file was not found in the catalogue.');

  const base = {
    country: COUNTRY,
    retrievedAt,
    providerId: PROVIDER_ID,
    providerKind: 'live' as const,
  };

  if (gdp && docs?.gdp) {
    const pub = published(releaseDates.gdp, gdp.at(-1)?.periodEnd ?? retrievedAt.slice(0, 10));
    observations.push(
      ...toObservations({
        ...base,
        points: gdp,
        indicatorType: 'gdp_growth',
        unit: 'percent',
        source: 'Stats NZ — production GDP, chain volume, seasonally adjusted, quarterly percent change',
        sourceUrl: releasePageUrl(docs.gdp.title),
        publishedAt: pub.at,
        publishedAtPrecision: pub.precision,
        frequency: 'quarterly',
        seriesId: STATS_SERIES.gdp,
        notes: null,
      }),
    );
  }

  const cpi = mergeCpi(cpiFile, oecdCpi, docs?.cpi ?? null, releaseDates.cpi);
  observations.push(...cpi.map((row) => ({ ...row, retrievedAt, providerId: PROVIDER_ID, providerKind: 'live' as const, country: COUNTRY })));

  if (retail && docs?.retail) {
    const pub = published(releaseDates.retail, retail.at(-1)?.periodEnd ?? retrievedAt.slice(0, 10));
    observations.push(
      ...toObservations({
        ...base,
        points: retail,
        indicatorType: 'consumer_spending',
        unit: 'percent',
        source: 'Stats NZ — retail trade, all industries, deflated, seasonally adjusted, percent change from the previous quarter',
        sourceUrl: releasePageUrl(docs.retail.title),
        publishedAt: pub.at,
        publishedAtPrecision: pub.precision,
        frequency: 'quarterly',
        seriesId: STATS_SERIES.retail,
        notes: null,
      }),
    );
  }

  if (jobs && docs?.employment) {
    const pub = published(releaseDates.employment, jobs.at(-1)?.periodEnd ?? retrievedAt.slice(0, 10));
    observations.push(
      ...toObservations({
        ...base,
        points: jobs,
        indicatorType: 'employment_growth',
        unit: 'percent',
        source: 'Stats NZ — employment indicators, filled jobs, all industries, seasonally adjusted',
        sourceUrl: releasePageUrl(docs.employment.title),
        publishedAt: pub.at,
        publishedAtPrecision: pub.precision,
        frequency: 'monthly',
        seriesId: STATS_SERIES.filledJobs,
        notes:
          'Annual percent change calculated in this app from the official level series. Stats NZ publishes the level; this growth rate is derived.',
      }),
    );
  }

  if (unemployment) {
    observations.push(
      ...toObservations({
        ...base,
        points: unemployment,
        indicatorType: 'unemployment',
        unit: 'percent',
        source: 'OECD — unemployment rate, seasonally adjusted, ages 15 and over, percent of the labour force',
        sourceUrl: OECD_URLS.unemployment,
        publishedAt: unemployment.at(-1)?.periodEnd ?? retrievedAt.slice(0, 10),
        publishedAtPrecision: 'period_end',
        frequency: 'quarterly',
        seriesId: 'UNE_LF_M',
        notes: 'The OECD extract does not include a publication timestamp. published_at is the period end. retrieved_at is when this app downloaded it.',
      }),
    );
  }

  if (callRate) {
    observations.push(
      ...toObservations({
        ...base,
        points: callRate,
        indicatorType: 'interest_rates',
        unit: 'percent',
        source: 'OECD — immediate interest rates, call money / interbank, percent per annum',
        sourceUrl: OECD_URLS.callRate,
        publishedAt: callRate.at(-1)?.periodEnd ?? retrievedAt.slice(0, 10),
        publishedAtPrecision: 'period_end',
        frequency: 'monthly',
        seriesId: 'IRSTCI',
        notes:
          'This is not the Reserve Bank of New Zealand Official Cash Rate table. The OECD extract has no publication timestamp; published_at is the period end.',
      }),
    );
  }

  if (yieldSpread) {
    observations.push(
      ...toObservations({
        ...base,
        points: yieldSpread,
        indicatorType: 'yield_curve',
        unit: 'percentage points',
        source: 'OECD — long-term interest rate minus short-term interest rate',
        sourceUrl: OECD_URLS.longRate,
        publishedAt: yieldSpread.at(-1)?.periodEnd ?? retrievedAt.slice(0, 10),
        publishedAtPrecision: 'period_end',
        frequency: 'monthly',
        seriesId: 'IRLT-IR3TIB',
        notes:
          'Percentage-point spread calculated in this app from the OECD long-term and short-term rates. published_at is the period end.',
      }),
    );
  }

  if (shares) {
    observations.push(
      ...toObservations({
        ...base,
        points: shares,
        indicatorType: 'share_market',
        unit: 'percent',
        source: 'OECD — share price index',
        sourceUrl: OECD_URLS.shares,
        publishedAt: shares.at(-1)?.periodEnd ?? retrievedAt.slice(0, 10),
        publishedAtPrecision: 'period_end',
        frequency: 'monthly',
        seriesId: 'SHARE',
        notes: 'Three-month percent change calculated in this app from the OECD share-price index. published_at is the period end.',
      }),
    );
  }

  warnings.push(
    'Business activity, credit conditions, and housing activity have no feed connected in this version.',
  );

  return {
    providerId: PROVIDER_ID,
    providerLabel: 'New Zealand public extracts (Stats NZ and OECD)',
    kind: 'live',
    country: COUNTRY,
    retrievedAt,
    observations,
    warnings,
  };
}

function mergeCpi(
  stats: WithPrevious[] | null,
  oecd: WithPrevious[] | null,
  doc: CatalogDoc | null,
  releaseDate: string | null,
): EconomicObservation[] {
  const byPeriod = new Map<string, EconomicObservation>();
  if (oecd) {
    for (const row of toObservations({
      points: oecd,
      country: COUNTRY,
      indicatorType: 'inflation_cpi',
      unit: 'percent',
      source: 'OECD — consumer price index, annual growth',
      sourceUrl: OECD_URLS.cpi,
      publishedAt: oecd.at(-1)?.periodEnd ?? '2012-01-01',
      publishedAtPrecision: 'period_end',
      retrievedAt: '',
      providerId: PROVIDER_ID,
      providerKind: 'live',
      frequency: 'quarterly',
      seriesId: 'CPI',
      notes:
        'OECD annual CPI growth, used where the latest Stats NZ CPI file does not include that quarter. published_at is the period end.',
    })) {
      byPeriod.set(row.period, row);
    }
  }
  if (stats && doc) {
    const pub = published(releaseDate, stats.at(-1)?.periodEnd ?? '2012-01-01');
    for (const row of toObservations({
      points: stats,
      country: COUNTRY,
      indicatorType: 'inflation_cpi',
      unit: 'percent',
      source: 'Stats NZ — consumers price index, all groups, annual percent change',
      sourceUrl: releasePageUrl(doc.title),
      publishedAt: pub.at,
      publishedAtPrecision: pub.precision,
      retrievedAt: '',
      providerId: PROVIDER_ID,
      providerKind: 'live',
      frequency: 'quarterly',
      seriesId: STATS_SERIES.cpi,
      notes: 'Stats NZ figure for this quarter replaces the OECD figure when both exist.',
    })) {
      byPeriod.set(row.period, row);
    }
  }
  const merged = [...byPeriod.values()].sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
  return merged.map((row, index) => ({
    ...row,
    previousValue: index > 0 ? merged[index - 1]!.value : null,
    previousPeriod: index > 0 ? merged[index - 1]!.period : null,
  }));
}

async function releaseDatesFor(
  docs: ReturnType<typeof selectStatsDocs> | null,
  warnings: string[],
): Promise<{ gdp: string | null; cpi: string | null; retail: string | null; employment: string | null }> {
  if (!docs) return { gdp: null, cpi: null, retail: null, employment: null };
  const [gdp, cpi, retail, employment] = await Promise.all([
    docs.gdp ? safe('Stats NZ GDP release date', warnings, () => fetchReleaseDate(docs.gdp!.title)) : Promise.resolve(null),
    docs.cpi ? safe('Stats NZ CPI release date', warnings, () => fetchReleaseDate(docs.cpi!.title)) : Promise.resolve(null),
    docs.retail
      ? safe('Stats NZ retail release date', warnings, () => fetchReleaseDate(docs.retail!.title))
      : Promise.resolve(null),
    docs.employment
      ? safe('Stats NZ employment release date', warnings, () => fetchReleaseDate(docs.employment!.title))
      : Promise.resolve(null),
  ]);
  return { gdp, cpi, retail, employment };
}
