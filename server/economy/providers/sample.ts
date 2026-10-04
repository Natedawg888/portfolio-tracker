/**
 * Opt-in fixture. Not used unless ECONOMY_PROVIDER=sample.
 * Values are rounded illustrations from 2019 and are labelled as such.
 */
import type { EconomicObservation, IndicatorType } from '../types.ts';
import { periodEnd, periodFromOecd } from '../periods.ts';
import type { EconomicDataProvider, ProviderFetchResult } from './types.ts';

const PROVIDER_ID = 'sample';
const SOURCE = 'Sample fixture — not a live or official statistic';

type Seed = { indicator: IndicatorType; unit: string; values: number[]; frequency: 'quarterly' | 'monthly' };

const SEEDS: Seed[] = [
  { indicator: 'gdp_growth', unit: 'percent', values: [0.4, 0.5, 0.6, 0.5], frequency: 'quarterly' },
  { indicator: 'inflation_cpi', unit: 'percent', values: [1.5, 1.6, 1.7, 1.7], frequency: 'quarterly' },
  { indicator: 'interest_rates', unit: 'percent', values: [1.8, 1.8, 1.7, 1.6], frequency: 'monthly' },
  { indicator: 'unemployment', unit: 'percent', values: [4.2, 4.1, 4.1, 4.0], frequency: 'quarterly' },
  { indicator: 'employment_growth', unit: 'percent', values: [1.6, 1.7, 1.8, 1.8], frequency: 'monthly' },
  { indicator: 'consumer_spending', unit: 'percent', values: [0.6, 0.7, 0.8, 0.7], frequency: 'quarterly' },
  { indicator: 'business_activity_pmi', unit: 'index', values: [53, 54, 54, 53], frequency: 'monthly' },
  { indicator: 'credit_conditions', unit: 'index', values: [0.4, 0.5, 0.6, 0.5], frequency: 'quarterly' },
  { indicator: 'housing_activity', unit: 'percent', values: [4, 5, 6, 5], frequency: 'monthly' },
  { indicator: 'share_market', unit: 'percent', values: [1, 2, 2, 1.5], frequency: 'monthly' },
  { indicator: 'yield_curve', unit: 'percentage points', values: [0.8, 0.9, 1.0, 0.9], frequency: 'quarterly' },
];

const PERIODS = ['2019-Q1', '2019-Q2', '2019-Q3', '2019-Q4'];
const MONTHS = ['2019-03', '2019-06', '2019-09', '2019-12'];

export function buildSampleObservations(retrievedAt: string, country = 'NZ'): EconomicObservation[] {
  const rows: EconomicObservation[] = [];
  for (const seed of SEEDS) {
    const periods = seed.frequency === 'monthly' ? MONTHS : PERIODS;
    periods.forEach((period, index) => {
      const range = periodFromOecd(period);
      if (!range) return;
      const previousPeriod = index > 0 ? periods[index - 1]! : null;
      rows.push({
        country,
        indicatorType: seed.indicator,
        value: seed.values[index] ?? seed.values[0]!,
        unit: seed.unit,
        period: range.period,
        periodStart: range.start,
        periodEnd: range.end,
        previousValue: index > 0 ? (seed.values[index - 1] ?? null) : null,
        previousPeriod,
        source: SOURCE,
        sourceUrl: null,
        publishedAt: periodEnd(range.period) ?? range.end,
        publishedAtPrecision: 'period_end',
        retrievedAt,
        providerId: PROVIDER_ID,
        providerKind: 'sample',
        frequency: seed.frequency,
        seriesId: 'sample',
        notes: 'Illustrative figures for layout only. They are not official statistics and are not current.',
      });
    });
  }
  return rows;
}

export const sampleProvider: EconomicDataProvider = {
  id: PROVIDER_ID,
  label: 'Sample fixture (not live)',
  kind: 'sample',
  country: 'NZ',
  async fetch(country = 'NZ'): Promise<ProviderFetchResult> {
    const retrievedAt = new Date().toISOString();
    const code = country === 'US' ? 'US' : 'NZ';
    return {
      providerId: PROVIDER_ID,
      providerLabel: this.label,
      kind: 'sample',
      country: code,
      retrievedAt,
      observations: buildSampleObservations(retrievedAt, code),
      warnings: ['Sample fixture is not a live official source. Do not treat these figures as current statistics.'],
    };
  },
};
