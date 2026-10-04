/**
 * United States observations from public OECD SDMX extracts and the Census
 * housing-starts workbook. OECD republishes national series (BEA, BLS, and
 * market rates). A failed series is omitted. It is never replaced with a made-up number.
 */
import type { EconomicObservation, IndicatorType } from '../types.ts';
import { attachPrevious, changeOverMonths, subtractSeries, type WithPrevious } from './derive.ts';
import { toObservations } from './observe.ts';
import { BUSINESS_ACTIVITY_NOTE, businessActivitySourceUrl, loadUsBusinessActivity, US_BUSINESS_KEY } from './businessActivity.ts';
import { loadUsCreditConditions, SLOOS_CI_TIGHTENING, SLOOS_URL } from './creditConditions.ts';
import { loadUsHousingGrowth } from './housingStarts.ts';
import { loadOecdMeasure, loadShareIndexChange, oecdKeiUrl } from './oecd.ts';
import type { ProviderFetchResult } from './types.ts';

const PROVIDER_ID = 'us-public';
const COUNTRY = 'US';
const REF = 'USA';

const SERIES = {
  gdp: `${REF}.Q.B1GQ_Q.GR._T.Y.G1`,
  cpi: `${REF}.M.CP.GR._Z._Z.GY`,
  unemployment: `${REF}.M.UNEMP.PT_LF._T.Y._Z`,
  rates: `${REF}.M.IRSTCI.PA._Z._Z._Z`,
  employment: `${REF}.M.EMP.PS._T.Y._Z`,
  spending: `${REF}.Q.P3_S1M_Q.GR._T.Y.G1`,
  longRate: `${REF}.M.IRLT.PA._Z._Z._Z`,
  shortRate: `${REF}.M.IR3TIB.PA._Z._Z._Z`,
} as const;

async function safe<T>(label: string, warnings: string[], task: () => Promise<T>): Promise<T | null> {
  try {
    return await task();
  } catch (err) {
    warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function loadKei(key: string, measure: string): Promise<WithPrevious[]> {
  return loadOecdMeasure(oecdKeiUrl(key), measure);
}

export async function fetchUsPublic(): Promise<ProviderFetchResult> {
  const retrievedAt = new Date().toISOString();
  const warnings: string[] = [];
  const observations: EconomicObservation[] = [];

  const [gdp, cpi, unemployment, rates, jobs, spending, longRate, shortRate, shares, housing, business, credit] =
    await Promise.all([
    safe('OECD US GDP', warnings, () => loadKei(SERIES.gdp, 'B1GQ_Q')),
    safe('OECD US CPI', warnings, () => loadKei(SERIES.cpi, 'CP')),
    safe('OECD US unemployment', warnings, () => loadKei(SERIES.unemployment, 'UNEMP')),
    safe('OECD US interest rates', warnings, () => loadKei(SERIES.rates, 'IRSTCI')),
    safe('OECD US employment', warnings, () => loadKei(SERIES.employment, 'EMP')),
    safe('OECD US household consumption', warnings, () => loadKei(SERIES.spending, 'P3_S1M_Q')),
    safe('OECD US long rate', warnings, () => loadKei(SERIES.longRate, 'IRLT')),
    safe('OECD US short rate', warnings, () => loadKei(SERIES.shortRate, 'IR3TIB')),
    safe('OECD US share prices', warnings, () => loadShareIndexChange(REF)),
    safe('Census housing starts', warnings, loadUsHousingGrowth),
    safe('OECD US business activity', warnings, loadUsBusinessActivity),
    safe('Federal Reserve credit standards', warnings, loadUsCreditConditions),
  ]);

  const base = {
    country: COUNTRY,
    retrievedAt,
    providerId: PROVIDER_ID,
    providerKind: 'live' as const,
  };
  const stamp = 'The OECD extract does not include a publication timestamp. published_at is the period end. retrieved_at is when this app downloaded it.';

  function push(
    points: WithPrevious[] | null,
    indicatorType: IndicatorType,
    unit: string,
    source: string,
    seriesId: string,
    sourceUrl: string | null,
    notes: string,
    frequency: 'monthly' | 'quarterly',
  ) {
    if (!points || points.length === 0) return;
    observations.push(
      ...toObservations({
        ...base,
        points,
        indicatorType,
        unit,
        source,
        sourceUrl,
        publishedAt: points.at(-1)?.periodEnd ?? retrievedAt.slice(0, 10),
        publishedAtPrecision: 'period_end',
        frequency,
        seriesId,
        notes,
      }),
    );
  }

  push(
    gdp,
    'gdp_growth',
    'percent',
    'OECD — gross domestic product, volume, seasonally adjusted, growth rate from the previous quarter',
    SERIES.gdp,
    oecdKeiUrl(SERIES.gdp),
    stamp,
    'quarterly',
  );
  push(
    cpi,
    'inflation_cpi',
    'percent',
    'OECD — consumer prices, growth rate over one year',
    SERIES.cpi,
    oecdKeiUrl(SERIES.cpi),
    stamp,
    'monthly',
  );
  push(
    unemployment,
    'unemployment',
    'percent',
    'OECD — unemployment rate, seasonally adjusted, percent of the labour force',
    SERIES.unemployment,
    oecdKeiUrl(SERIES.unemployment),
    stamp,
    'monthly',
  );
  push(
    rates,
    'interest_rates',
    'percent',
    'OECD — immediate interest rates, call money / interbank, percent per annum',
    SERIES.rates,
    oecdKeiUrl(SERIES.rates),
    `${stamp} This is not the Federal Reserve policy-target table.`,
    'monthly',
  );
  if (jobs && jobs.length > 0) {
    push(
      attachPrevious(changeOverMonths(jobs, 12)),
      'employment_growth',
      'percent',
      'OECD — employment, seasonally adjusted',
      SERIES.employment,
      oecdKeiUrl(SERIES.employment),
      `${stamp} Annual percent change calculated in this app from the official level series.`,
      'monthly',
    );
  }
  push(
    spending,
    'consumer_spending',
    'percent',
    'OECD — household consumption, volume, seasonally adjusted, growth rate from the previous quarter',
    SERIES.spending,
    oecdKeiUrl(SERIES.spending),
    stamp,
    'quarterly',
  );
  if (longRate && shortRate) {
    push(
      attachPrevious(subtractSeries(longRate, shortRate)),
      'yield_curve',
      'percentage points',
      'OECD — long-term interest rate minus short-term interest rate',
      'IRLT-IR3TIB',
      oecdKeiUrl(SERIES.longRate),
      `${stamp} Percentage-point spread calculated in this app.`,
      'monthly',
    );
  }
  if (housing && housing.rates.length > 0) {
    const publishedAt = housing.publishedAt ?? housing.rates.at(-1)?.periodEnd ?? retrievedAt.slice(0, 10);
    observations.push(
      ...toObservations({
        ...base,
        points: housing.rates,
        indicatorType: 'housing_activity',
        unit: 'percent',
        source:
          'U.S. Census Bureau and U.S. Department of Housing and Urban Development — new privately owned housing units started, seasonally adjusted annual rate',
        sourceUrl: 'https://www.census.gov/construction/nrc/xls/starts_cust.xlsx',
        publishedAt,
        publishedAtPrecision: housing.publishedAt ? 'release' : 'period_end',
        frequency: 'monthly',
        seriesId: 'starts_cust',
        notes: housing.publishedAt
          ? 'Annual percent change calculated in this app from the national seasonally adjusted annual rate, in thousands of units. published_at is the workbook Last-Modified date. This is housing starts, not house prices.'
          : `${stamp} Annual percent change calculated in this app from the national seasonally adjusted annual rate, in thousands of units.`,
      }),
    );
  }
  if (business && business.length > 0) {
    push(
      business,
      'business_activity_pmi',
      'index',
      'OECD — production tendency, percentage balance, calendar and seasonally adjusted',
      'PR',
      businessActivitySourceUrl(US_BUSINESS_KEY),
      BUSINESS_ACTIVITY_NOTE,
      'monthly',
    );
  }
  if (credit && credit.rates.length > 0) {
    const publishedAt = credit.publishedAt ?? credit.rates.at(-1)?.periodEnd ?? retrievedAt.slice(0, 10);
    observations.push(
      ...toObservations({
        ...base,
        points: credit.rates,
        indicatorType: 'credit_conditions',
        unit: 'percent',
        source:
          'Federal Reserve — Senior Loan Officer Opinion Survey, net percentage of domestic banks tightening standards for commercial and industrial loans to large and middle-market firms',
        sourceUrl: SLOOS_URL,
        publishedAt,
        publishedAtPrecision: credit.publishedAt ? 'release' : 'period_end',
        frequency: 'quarterly',
        seriesId: SLOOS_CI_TIGHTENING,
        notes: credit.publishedAt
          ? 'Net percentage easing, calculated in this app as the negative of the published net-tightening figure, so a higher number means easier credit. published_at is the file Last-Modified date.'
          : 'Net percentage easing, calculated in this app as the negative of the published net-tightening figure, so a higher number means easier credit. The file has no Last-Modified date, so published_at is the period end.',
      }),
    );
  }
  if (shares && shares.length > 0) {
    observations.push(
      ...toObservations({
        ...base,
        points: shares,
        indicatorType: 'share_market',
        unit: 'percent',
        source: 'OECD — share price index',
        sourceUrl: `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_FINMARK,4.0/${REF}.M.SHARE.IX._Z._Z._Z._Z.N`,
        publishedAt: shares.at(-1)?.periodEnd ?? retrievedAt.slice(0, 10),
        publishedAtPrecision: 'period_end',
        frequency: 'monthly',
        seriesId: 'SHARE',
        notes: `${stamp} Three-month percent change calculated in this app from the OECD share-price index.`,
      }),
    );
  }

  return {
    providerId: PROVIDER_ID,
    providerLabel: 'United States public extracts (OECD, Census Bureau, and the Federal Reserve)',
    kind: 'live',
    country: COUNTRY,
    retrievedAt,
    observations,
    warnings,
  };
}
