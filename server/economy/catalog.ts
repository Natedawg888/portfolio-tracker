/**
 * Indicator catalogue: names, what the series means, and how old a print can
 * be before the UI must stop calling it current.
 */
import { INDICATOR_TYPES, type Frequency, type IndicatorType } from './types.ts';

export type IndicatorMeta = {
  label: string;
  description: string;
  frequency: Frequency;
  /** Age of the period end, in days, after which the card is marked stale. */
  staleAfterDays: number;
};

export const INDICATOR_CATALOG: Record<IndicatorType, IndicatorMeta> = {
  gdp_growth: {
    label: 'GDP growth',
    description:
      'Seasonally adjusted quarterly percent change in production GDP. Historically this series is revised after the first release.',
    frequency: 'quarterly',
    staleAfterDays: 200,
  },
  inflation_cpi: {
    label: 'Inflation (CPI)',
    description:
      'Consumers price index, all groups, percent change from the same period a year earlier. The 1–3 percent range is the published policy band used here only as a threshold.',
    frequency: 'quarterly',
    staleAfterDays: 200,
  },
  interest_rates: {
    label: 'Interest rates',
    description:
      'A short-term wholesale interest rate, percent per annum. The connected series is an interbank rate, not the Reserve Bank Official Cash Rate table.',
    frequency: 'monthly',
    staleAfterDays: 75,
  },
  unemployment: {
    label: 'Unemployment',
    description:
      'Seasonally adjusted unemployment rate for people aged 15 and over, as a percent of the labour force.',
    frequency: 'quarterly',
    staleAfterDays: 200,
  },
  employment_growth: {
    label: 'Employment growth',
    description:
      'Annual percent change in seasonally adjusted filled jobs. Historically, employment has often turned after GDP.',
    frequency: 'monthly',
    staleAfterDays: 75,
  },
  consumer_spending: {
    label: 'Consumer spending',
    description:
      'Quarterly percent change in real retail sales, seasonally adjusted. It is a spending indicator, not household consumption in the national accounts.',
    frequency: 'quarterly',
    staleAfterDays: 200,
  },
  business_activity_pmi: {
    label: 'Business activity',
    description:
      'Diffusion index of the production tendency. Calculated in this app as 50 plus half the OECD percentage balance, so 50 is the published neutral point. It is not a branded purchasing managers’ index.',
    frequency: 'quarterly',
    staleAfterDays: 200,
  },
  credit_conditions: {
    label: 'Credit conditions',
    description:
      'Whether credit is loosening or tightening. The Reserve Bank of New Zealand credit conditions survey is the official series: the published index of credit availability for corporate and institutional loans over the past six months. A higher number means easier credit.',
    frequency: 'quarterly',
    staleAfterDays: 200,
  },
  housing_activity: {
    label: 'Housing activity',
    description:
      'Annual percent change in the seasonally adjusted number of new dwellings consented. The growth rate is calculated in this app from the official count in the monthly workbook. The full consents CSV is not downloaded.',
    frequency: 'monthly',
    staleAfterDays: 75,
  },
  share_market: {
    label: 'Share market',
    description:
      'Percent change over three months in a New Zealand share-price index. Markets have often moved before the broader economy; that is historical context, not a signal.',
    frequency: 'monthly',
    staleAfterDays: 75,
  },
  yield_curve: {
    label: 'Yield curve',
    description:
      'Long-term interest rate minus the short-term rate, in percentage points. A low or negative spread has often appeared before slower growth. It is not a forecast.',
    frequency: 'monthly',
    staleAfterDays: 75,
  },
};

export function catalogIndicators(): IndicatorType[] {
  return [...INDICATOR_TYPES];
}
