/**
 * Countries the economic cycle can show. Add a row here, then a provider that
 * returns observations for that code. The page reads this list; it does not
 * keep its own copy of the countries.
 */
import type { IndicatorType } from './types.ts';

export type EconomyCountryCode = 'NZ' | 'US';

export type EconomyNewsTopic = {
  id: string;
  title: string;
  query: string;
};

export type EconomyCountry = {
  code: EconomyCountryCode;
  name: string;
  /** Place name used inside Google News searches. */
  searchName: string;
  topics: EconomyNewsTopic[];
  descriptions: Partial<Record<IndicatorType, string>>;
};

const NZ_TOPICS: EconomyNewsTopic[] = [
  {
    id: 'rates',
    title: 'Central-bank rates',
    query: '("Reserve Bank of New Zealand" OR RBNZ) (OCR OR "official cash rate" OR "interest rate")',
  },
  { id: 'gdp', title: 'GDP', query: '"New Zealand" (GDP OR "gross domestic product")' },
  { id: 'inflation', title: 'Inflation', query: '"New Zealand" (inflation OR CPI OR "consumers price index")' },
  {
    id: 'unemployment',
    title: 'Unemployment',
    query: '"New Zealand" (unemployment OR "jobless rate" OR "unemployment rate")',
  },
  {
    id: 'housing',
    title: 'Housing',
    query: '"New Zealand" (housing OR "house prices" OR "building consents")',
  },
  {
    id: 'global',
    title: 'Global economy',
    query: '("world economy" OR "global economy" OR IMF OR "Federal Reserve" OR "European Central Bank")',
  },
];

const US_TOPICS: EconomyNewsTopic[] = [
  {
    id: 'rates',
    title: 'Central-bank rates',
    query: '"Federal Reserve" ("federal funds" OR "interest rate" OR "rate decision")',
  },
  { id: 'gdp', title: 'GDP', query: '"United States" (GDP OR "gross domestic product")' },
  { id: 'inflation', title: 'Inflation', query: '"United States" (inflation OR CPI OR "consumer price")' },
  {
    id: 'unemployment',
    title: 'Unemployment',
    query: '"United States" (unemployment OR "jobless rate" OR "unemployment rate")',
  },
  {
    id: 'housing',
    title: 'Housing',
    query: '"United States" (housing OR "house prices" OR "housing starts")',
  },
  {
    id: 'markets',
    title: 'Markets',
    query: '("United States" OR "Wall Street") ("stock market" OR "S&P 500" OR shares)',
  },
];

export const ECONOMY_COUNTRIES: EconomyCountry[] = [
  {
    code: 'NZ',
    name: 'New Zealand',
    searchName: 'New Zealand',
    topics: NZ_TOPICS,
    descriptions: {},
  },
  {
    code: 'US',
    name: 'United States',
    searchName: 'United States',
    topics: US_TOPICS,
    descriptions: {
      gdp_growth:
        'Seasonally adjusted quarterly percent change in real GDP volume. The OECD figure is the growth rate from the previous quarter, not an annualised rate.',
      inflation_cpi: 'Consumer prices, percent change from the same month a year earlier.',
      interest_rates:
        'Immediate interest rate, call money or interbank, percent per annum. This is not a table of the Federal Reserve policy target.',
      unemployment: 'Seasonally adjusted unemployment rate, percent of the labour force.',
      employment_growth:
        'Annual percent change in employment. The growth rate is calculated in this app from the published level.',
      consumer_spending:
        'Quarterly percent change in real household consumption. It is a national-accounts series, not a retail-sales release.',
      business_activity_pmi:
        'Diffusion index of the production tendency. Calculated in this app as 50 plus half the OECD percentage balance, so 50 is the published neutral point. It is not a branded purchasing managers’ index.',
      credit_conditions:
        'Net percentage of domestic banks easing standards on commercial and industrial loans to large and middle-market firms. Calculated as the negative of the Federal Reserve net-tightening figure, so a higher number means easier credit.',
      housing_activity:
        'Annual percent change in new privately owned housing units started, seasonally adjusted annual rate. The growth rate is calculated in this app from the Census Bureau count. It is not a house-price index.',
      share_market:
        'Percent change over three months in a United States share-price index. The change is calculated in this app from the index.',
      yield_curve:
        'Long-term interest rate minus the short-term rate, in percentage points. The spread is calculated in this app.',
    },
  },
];

export function listEconomyCountries(): Array<{ code: string; name: string }> {
  return ECONOMY_COUNTRIES.map((country) => ({ code: country.code, name: country.name }));
}

export function economyCountry(code: string | undefined | null): EconomyCountry | null {
  const normalised = (code ?? 'NZ').trim().toUpperCase() || 'NZ';
  return ECONOMY_COUNTRIES.find((country) => country.code === normalised) ?? null;
}

export class EconomyCountryError extends Error {
  constructor(country: string) {
    const supported = ECONOMY_COUNTRIES.map((row) => row.code).join(', ');
    super(`Economic cycle data is connected for ${supported}. Received ${country || '(blank)'}.`);
    this.name = 'EconomyCountryError';
  }
}

export function requireEconomyCountry(code: string | undefined | null): EconomyCountry {
  const found = economyCountry(code);
  if (!found) throw new EconomyCountryError(code ?? '');
  return found;
}
