/**
 * Links from Value Search into Portfolio: `?add=…` opens an add form pre-filled,
 * `?holding=<id>` scrolls to a holding. The hash stays the tab (#stocks, #metals…).
 * Params come from a URL anyone can edit, so parsing drops anything malformed.
 * Run tests: npm run test:value-search
 */
import { CARD_FINISHES, type ApiCardGame } from './collectables.ts';
import type { PortfolioTab } from './portfolioView.ts';
import type { MetalName } from './valueSearchDetect.ts';

/** Currencies the Portfolio forex form offers. */
export const FOREX_CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'JPY', 'SGD'] as const;
export type ForexCurrency = (typeof FOREX_CURRENCIES)[number];

export type PortfolioAddRequest =
  | { kind: 'stock'; ticker: string }
  | { kind: 'crypto'; ticker: string }
  | { kind: 'metal'; metal: MetalName; amount: number | null; unit: 'g' | 'oz_t' | null }
  | { kind: 'forex'; currency: ForexCurrency; amount: number | null }
  | { kind: 'miner'; ths: number | null; wPerTh: number | null }
  | {
      kind: 'card';
      game: ApiCardGame;
      name: string | null;
      set: string | null;
      number: string | null;
      finish: string | null;
      apiId: string | null;
    };

export type PortfolioAddKind = PortfolioAddRequest['kind'];

export const ADD_TAB: Record<PortfolioAddKind, PortfolioTab> = {
  stock: 'stocks',
  crypto: 'crypto',
  metal: 'metals',
  forex: 'other',
  miner: 'mining',
  card: 'collectables',
};

/** Every query param these links use; Portfolio removes them once handled. */
export const PORTFOLIO_LINK_PARAMS = [
  'add', 'ticker', 'amount', 'metal', 'unit', 'currency', 'ths', 'wPerTh',
  'game', 'name', 'set', 'number', 'finish', 'apiId', 'holding',
] as const;

const METALS: readonly MetalName[] = ['gold', 'silver', 'platinum', 'palladium'];
const TICKER_RE = /^[A-Z0-9.:-]{1,15}$/;
const API_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_TEXT = 120;

function positive(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function text(raw: string | null): string | null {
  const t = raw?.trim() ?? '';
  return t && t.length <= MAX_TEXT ? t : null;
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  return allowed.find((a) => a === raw) ?? null;
}

/** null when there is no `add` param or the request is unusable (e.g. a stock with no ticker). */
export function parsePortfolioAddParams(params: URLSearchParams): PortfolioAddRequest | null {
  const ticker = params.get('ticker')?.trim().toUpperCase() ?? '';
  switch (params.get('add')) {
    case 'stock':
    case 'crypto':
      return TICKER_RE.test(ticker) ? { kind: params.get('add') as 'stock' | 'crypto', ticker } : null;
    case 'metal': {
      const metal = oneOf(params.get('metal'), METALS);
      return metal
        ? { kind: 'metal', metal, amount: positive(params.get('amount')), unit: oneOf(params.get('unit'), ['g', 'oz_t'] as const) }
        : null;
    }
    case 'forex': {
      const currency = oneOf(params.get('currency')?.toUpperCase() ?? null, FOREX_CURRENCIES);
      return currency ? { kind: 'forex', currency, amount: positive(params.get('amount')) } : null;
    }
    case 'miner':
      return { kind: 'miner', ths: positive(params.get('ths')), wPerTh: positive(params.get('wPerTh')) };
    case 'card': {
      const game = oneOf(params.get('game'), ['mtg', 'pokemon'] as const);
      if (!game) return null;
      const apiId = params.get('apiId');
      const finish = params.get('finish');
      const card = {
        kind: 'card' as const,
        game,
        name: text(params.get('name')),
        set: text(params.get('set')),
        number: text(params.get('number')),
        finish: CARD_FINISHES[game].some((f) => f.value === finish) ? finish : null,
        apiId: apiId && API_ID_RE.test(apiId) ? apiId : null,
      };
      return card.name || card.apiId ? card : null;
    }
    default:
      return null;
  }
}

/** The Portfolio link that opens the matching add form, pre-filled. */
export function portfolioAddHref(req: PortfolioAddRequest): string {
  const { kind, ...fields } = req;
  const params = new URLSearchParams({ add: kind });
  for (const [key, value] of Object.entries(fields)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  return `/portfolio?${params}#${ADD_TAB[kind]}`;
}

export function holdingHref(tab: PortfolioTab, holdingId: string): string {
  return `/portfolio?${new URLSearchParams({ holding: holdingId })}#${tab}`;
}
