/**
 * Frankfurter currency catalogue + country/region search aliases.
 * Names come from https://api.frankfurter.dev/v1/currencies — never invent rates.
 */
const UA = 'PortfolioTracker/1.0 (local NZD portfolio; +https://localhost)';
const FETCH_MS = 12_000;
const CACHE_MS = 24 * 60 * 60_000;

export type FxCurrencyInfo = {
  code: string;
  name: string;
  /** Free-text tokens for searchable dropdowns (country / region / aliases). */
  countries: string[];
  searchText: string;
};

/** Country / region aliases keyed by ISO 4217 (Frankfurter set). */
const COUNTRY_ALIASES: Record<string, string[]> = {
  AUD: ['Australia', 'Australian'],
  BRL: ['Brazil', 'Brazilian'],
  CAD: ['Canada', 'Canadian'],
  CHF: ['Switzerland', 'Swiss', 'Liechtenstein'],
  CNY: ['China', 'Chinese', 'PRC'],
  CZK: ['Czechia', 'Czech Republic', 'Czech'],
  DKK: ['Denmark', 'Danish', 'Greenland', 'Faroe Islands'],
  EUR: [
    'Eurozone',
    'Europe',
    'European Union',
    'EU',
    'Germany',
    'France',
    'Italy',
    'Spain',
    'Netherlands',
    'Ireland',
    'Austria',
    'Belgium',
    'Portugal',
    'Finland',
    'Greece',
  ],
  GBP: ['United Kingdom', 'UK', 'Britain', 'British', 'England', 'Scotland', 'Wales'],
  HKD: ['Hong Kong'],
  HUF: ['Hungary', 'Hungarian'],
  IDR: ['Indonesia', 'Indonesian'],
  ILS: ['Israel', 'Israeli'],
  INR: ['India', 'Indian'],
  ISK: ['Iceland', 'Icelandic'],
  JPY: ['Japan', 'Japanese'],
  KRW: ['South Korea', 'Korea', 'Korean', 'Republic of Korea'],
  MXN: ['Mexico', 'Mexican'],
  MYR: ['Malaysia', 'Malaysian'],
  NOK: ['Norway', 'Norwegian'],
  NZD: ['New Zealand', 'NZ', 'Aotearoa'],
  PHP: ['Philippines', 'Philippine', 'Filipino'],
  PLN: ['Poland', 'Polish'],
  RON: ['Romania', 'Romanian'],
  SEK: ['Sweden', 'Swedish'],
  SGD: ['Singapore', 'Singaporean'],
  THB: ['Thailand', 'Thai'],
  TRY: ['Turkey', 'Türkiye', 'Turkish'],
  USD: ['United States', 'USA', 'US', 'America', 'American'],
  ZAR: ['South Africa', 'South African'],
};

/** Offline fallback if Frankfurter /currencies is unreachable (codes + ECB names). */
const STATIC_FRANKFURTER: Record<string, string> = {
  AUD: 'Australian Dollar',
  BRL: 'Brazilian Real',
  CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',
  CNY: 'Chinese Renminbi Yuan',
  CZK: 'Czech Koruna',
  DKK: 'Danish Krone',
  EUR: 'Euro',
  GBP: 'British Pound',
  HKD: 'Hong Kong Dollar',
  HUF: 'Hungarian Forint',
  IDR: 'Indonesian Rupiah',
  ILS: 'Israeli New Shekel',
  INR: 'Indian Rupee',
  ISK: 'Icelandic Króna',
  JPY: 'Japanese Yen',
  KRW: 'South Korean Won',
  MXN: 'Mexican Peso',
  MYR: 'Malaysian Ringgit',
  NOK: 'Norwegian Krone',
  NZD: 'New Zealand Dollar',
  PHP: 'Philippine Peso',
  PLN: 'Polish Złoty',
  RON: 'Romanian Leu',
  SEK: 'Swedish Krona',
  SGD: 'Singapore Dollar',
  THB: 'Thai Baht',
  TRY: 'Turkish Lira',
  USD: 'United States Dollar',
  ZAR: 'South African Rand',
};

let cache: { at: number; list: FxCurrencyInfo[] } | null = null;

function buildInfo(code: string, name: string): FxCurrencyInfo {
  const c = code.toUpperCase();
  const countries = COUNTRY_ALIASES[c] ?? [];
  const searchText = [c, name, ...countries].join(' ').toLowerCase();
  return { code: c, name, countries, searchText };
}

function fromMap(map: Record<string, string>): FxCurrencyInfo[] {
  return Object.entries(map)
    .map(([code, name]) => buildInfo(code, name))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * All Frankfurter-supported currencies with country search aliases.
 * Live from Frankfurter when possible; static ECB set fallback (no invented rates).
 */
export async function listFrankfurterCurrencies(force = false): Promise<{
  currencies: FxCurrencyInfo[];
  source: 'frankfurter' | 'static_fallback';
  asOf: string;
  message: string | null;
}> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return {
      currencies: cache.list,
      source: 'frankfurter',
      asOf: new Date(cache.at).toISOString(),
      message: null,
    };
  }

  const asOf = new Date().toISOString();
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/currencies', {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      const list = fromMap(STATIC_FRANKFURTER);
      return {
        currencies: list,
        source: 'static_fallback',
        asOf,
        message: `Frankfurter currencies HTTP ${res.status}; using static ECB set`,
      };
    }
    const data = JSON.parse(text) as Record<string, string>;
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      const list = fromMap(STATIC_FRANKFURTER);
      return {
        currencies: list,
        source: 'static_fallback',
        asOf,
        message: 'Frankfurter currencies empty; using static ECB set',
      };
    }
    const list = fromMap(data);
    cache = { at: Date.now(), list };
    return { currencies: list, source: 'frankfurter', asOf, message: null };
  } catch (err) {
    const list = fromMap(STATIC_FRANKFURTER);
    return {
      currencies: list,
      source: 'static_fallback',
      asOf,
      message: `Frankfurter currencies fetch failed: ${(err as Error).message}; using static ECB set`,
    };
  }
}

export function clearFxCurrencyCache(): void {
  cache = null;
}

/** Known Frankfurter codes (static) — for quick validation without network. */
export function staticFrankfurterCodes(): string[] {
  return Object.keys(STATIC_FRANKFURTER).sort();
}
