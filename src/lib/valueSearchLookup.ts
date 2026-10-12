/**
 * Value Search lookups: one parsed query → one result card, using the existing quote APIs.
 * Never invents a value: anything not 'ok' (or labelled 'stale') comes back unavailable.
 */
import { api } from '../api/client';
import {
  estimateMinerEarnings,
  type BtcFxRates,
  type GoMiningNetworkParams,
} from './gominingEarnings';
import {
  SOURCE_NAME,
  type MetalAmountUnit,
  type MetalName,
  type ParsedQuery,
  type SearchType,
} from './valueSearchDetect';

export type ResultStatus =
  | { kind: 'live' }
  | { kind: 'stale' }
  | { kind: 'estimate' }
  | { kind: 'unavailable'; message: string | null };

type ResultBase = {
  title: string;
  /** Inputs the value depends on, including any assumed defaults. */
  detail: string | null;
  /** Headline value in `currency`; null exactly when status is unavailable. */
  value: number | null;
  currency: string;
  /** Unit / conversion note under the value: "per share in NZD · USD 20 × 1.7". */
  note: string | null;
  status: ResultStatus;
  /** Display name of the source, e.g. "Yahoo Finance · Frankfurter". */
  source: string;
  asOf: string | null;
};

export type CardPrinting = {
  name: string;
  set: string | null;
  number: string | null;
  finish: string | null;
  apiId: string | null;
};

export type MinerPeriod = { nzd: number | null; btc: number | null };

/** A live figure the miner model depends on, and whether it was available. */
export type MinerLiveInput = { label: string; ok: boolean; detail: string | null };

export type WPerThFrom = 'query' | 'input' | 'held' | 'default';

export type LookupResult = ResultBase &
  (
    | { type: 'stock' | 'crypto'; symbol: string }
    | { type: 'mtg' | 'pokemon'; card: CardPrinting }
    | {
        type: 'metal';
        metal: MetalName;
        /** NZD per troy ounce; the card converts it to the chosen unit. */
        perOzNzd: number | null;
        amount: number | null;
        amountUnit: MetalAmountUnit | null;
      }
    | { type: 'currency'; from: string; to: string; amount: number | null; rate: number | null }
    | {
        type: 'miner';
        ths: number;
        wPerTh: number;
        wPerThFrom: WPerThFrom;
        discountPct: number;
        periods: Record<'day' | 'month' | 'year', MinerPeriod>;
        liveInputs: MinerLiveInput[];
      }
    | { type: 'diamond' }
  );

/** Card refinements typed in the result card; empty strings mean "not given". */
export type CardRefine = { set: string; number: string; finish: string };

export type LookupInput = {
  parsed: ParsedQuery;
  /** W/TH from the user's own miners, when the query doesn't give one. */
  heldWPerTh: number | null;
  card: CardRefine;
  /** Miner inputs edited in the result card; null keeps the default. */
  miner: { wPerTh: number | null; discountPct: number | null };
};

const SOURCE_LABEL: Record<string, string> = {
  yahoo: 'Yahoo Finance',
  'yahoo+frankfurter': 'Yahoo Finance · Frankfurter',
  coingecko: 'CoinGecko',
  coinbase: 'Coinbase',
  'coinbase+frankfurter': 'Coinbase · Frankfurter',
  kraken: 'Kraken',
  'kraken+frankfurter': 'Kraken · Frankfurter',
  scryfall: 'Scryfall',
  'pokemontcg.io': 'pokemontcg.io',
  'gold-api': 'gold-api.com',
  metals_dev: 'Metals.Dev',
  frankfurter: 'Frankfurter',
  cross_via_nzd: 'Frankfurter (via NZD)',
  btc_fx_ratio: 'BTC FX ratio',
  openfacet: 'OpenFacet',
  gomining: 'GoMining',
};

function sourceName(raw: string | null | undefined, type: SearchType): string {
  if (!raw || raw === 'stub') return SOURCE_NAME[type];
  return SOURCE_LABEL[raw] ?? raw;
}

/** Previous Value Search miner form default, shown as an assumption on the card. */
export const DEFAULT_W_PER_TH = 20;
const DIAMOND_DEFAULTS = { colour: 'G', clarity: 'VS2', shape: 'round' } as const;

function quoteStatus(status: string, price: number | null, message?: string | null): ResultStatus {
  if (price == null) return { kind: 'unavailable', message: message ?? null };
  if (status === 'ok') return { kind: 'live' };
  if (status === 'stale') return { kind: 'stale' };
  return { kind: 'unavailable', message: message ?? null };
}

function valueIfAvailable(status: ResultStatus, value: number | null): number | null {
  return status.kind === 'unavailable' ? null : value;
}

const nativeFmt = (n: number) => n.toLocaleString('en-NZ', { maximumFractionDigits: 6 });

function conversionNote(per: string, native: { price: number; currency: string; fxRate: number } | null): string {
  const base = `per ${per} in NZD`;
  if (!native || native.currency === 'NZD') return base;
  return `${base} · ${native.currency} ${nativeFmt(native.price)} × ${native.fxRate}`;
}

async function lookupTicker(symbol: string, type: 'stock' | 'crypto'): Promise<LookupResult> {
  const r = await api.quotes.resolveTicker(symbol, type);
  const status = quoteStatus(r.stale ? 'stale' : r.quote.status, r.quote.price, r.quote.message);
  const native =
    r.nativePrice != null && r.nativeCurrency && r.fxRate != null
      ? { price: r.nativePrice, currency: r.nativeCurrency, fxRate: r.fxRate }
      : null;
  return {
    type,
    symbol: r.ticker,
    title: r.name && r.name !== r.ticker ? `${r.ticker} · ${r.name}` : r.ticker,
    detail: null,
    value: valueIfAvailable(status, r.quote.price),
    currency: 'NZD',
    note: conversionNote(type === 'stock' ? 'share' : 'coin', native),
    status,
    source: sourceName(r.quote.source, type),
    asOf: r.quote.asOf,
  };
}

async function lookupCard(
  parsed: Extract<ParsedQuery, { type: 'mtg' | 'pokemon' }>,
  refine: CardRefine,
): Promise<LookupResult> {
  const byId = 'apiId' in parsed;
  const { quote } = await api.quotes.cardQuote({
    game: parsed.type,
    ...(byId ? { apiId: parsed.apiId } : { name: parsed.name, set: refine.set, number: refine.number }),
    finish: refine.finish,
  });
  const status = quoteStatus(quote.status, quote.unitNzd, quote.message);
  const card: CardPrinting = {
    name: quote.name || (byId ? parsed.apiId : parsed.name),
    set: quote.set,
    number: quote.number,
    finish: quote.finish,
    apiId: quote.apiId,
  };
  const title = [card.name, card.set?.toUpperCase(), card.number ? `#${card.number}` : null]
    .filter(Boolean)
    .join(' · ');
  return {
    type: parsed.type,
    card,
    title,
    detail: card.finish ? `Finish: ${card.finish}` : null,
    value: valueIfAvailable(status, quote.unitNzd),
    currency: 'NZD',
    note:
      quote.unitUsd != null && quote.fxRate != null
        ? `per card · US$${nativeFmt(quote.unitUsd)} × ${quote.fxRate}`
        : 'per card',
    status,
    source: sourceName(quote.source, parsed.type),
    asOf: quote.asOf,
  };
}

async function lookupMetal(parsed: Extract<ParsedQuery, { type: 'metal' }>): Promise<LookupResult> {
  const data = await api.quotes.metals(false);
  const q = data.quotes.find((m) => m.metal === parsed.metal);
  const base = {
    type: 'metal' as const,
    metal: parsed.metal,
    amount: parsed.amount,
    amountUnit: parsed.unit,
    title: parsed.metal[0].toUpperCase() + parsed.metal.slice(1),
    detail: null,
    currency: 'NZD',
    // The card sets value and note for the chosen unit (metalHeadline).
    note: null,
  };
  if (!q) {
    return {
      ...base,
      perOzNzd: null,
      value: null,
      status: { kind: 'unavailable', message: `No ${parsed.metal} quote returned` },
      source: SOURCE_NAME.metal,
      asOf: null,
    };
  }
  const status = quoteStatus(q.status, q.price, q.message);
  const perOz = valueIfAvailable(status, q.price);
  return {
    ...base,
    perOzNzd: perOz,
    value: perOz,
    status,
    source: sourceName(q.source, 'metal'),
    asOf: q.asOf,
  };
}

async function lookupCurrency(
  parsed: Extract<ParsedQuery, { type: 'currency' }>,
  force: boolean,
): Promise<LookupResult> {
  const data = await api.quotes.fx({
    from: parsed.from,
    to: parsed.to,
    amount: parsed.amount ?? undefined,
    force,
  });
  const status = quoteStatus(data.status, data.rate, data.message);
  const converted = parsed.amount != null ? data.convertedAmount : data.rate;
  const rate = status.kind === 'unavailable' ? null : data.rate;
  return {
    type: 'currency',
    from: data.fromCurrency,
    to: data.toCurrency,
    amount: parsed.amount,
    rate,
    title: `${data.fromCurrency} → ${data.toCurrency}`,
    detail: parsed.amount != null ? `${parsed.amount} ${data.fromCurrency}` : null,
    value: valueIfAvailable(status, converted),
    currency: data.toCurrency,
    note: rate != null ? `1 ${data.fromCurrency} = ${rate} ${data.toCurrency}` : null,
    status,
    source: sourceName(data.source, 'currency'),
    asOf: data.asOf,
  };
}

async function lookupMiner(
  parsed: Extract<ParsedQuery, { type: 'miner' }>,
  input: LookupInput,
): Promise<LookupResult> {
  const g = await api.settings.getGomining();
  const income = g.income?.status === 'ok' ? g.income : null;
  const networkHashrateEhs =
    g.networkHashrateEhs ??
    g.effective?.networkHashrateEhs ??
    (g.networkHashrate?.status === 'ok' ? g.networkHashrate.networkHashrateEhs : null);
  const network: GoMiningNetworkParams = {
    btcUsd: g.btcUsd ?? income?.btcCourseInUsd ?? null,
    poolIncomeUsdPerTh: income?.poolIncomeUsdPerTh ?? null,
    poolIncomeBtcPerTh: income?.poolIncomeBtcPerTh ?? null,
    goBtcPaySatPerTh: income?.goBtcPaySatPerTh ?? null,
    goBtcPayBtcPerTh: income?.goBtcPayBtcPerTh ?? null,
    networkHashrateEhs,
    dailyBtcIssuance: g.dailyBtcIssuance,
    kWhCostUsd: g.kWhCostUsd ?? income?.impliedKwhCostUsd ?? null,
  };
  const fx: BtcFxRates | null = g.fx
    ? {
        btcUsd: g.fx.btcUsd,
        btcNzd: g.fx.btcNzd,
        source: g.fx.source,
        asOf: g.fx.asOf,
        status: g.fx.status,
        message: g.fx.message,
      }
    : null;
  const [wPerTh, wPerThFrom]: [number, WPerThFrom] =
    input.miner.wPerTh != null
      ? [input.miner.wPerTh, 'input']
      : parsed.wPerTh != null
        ? [parsed.wPerTh, 'query']
        : input.heldWPerTh != null
          ? [input.heldWPerTh, 'held']
          : [DEFAULT_W_PER_TH, 'default'];
  const estimate = estimateMinerEarnings({
    hashrateThs: parsed.ths,
    energyEfficiencyWth: wPerTh,
    discountPct: input.miner.discountPct ?? (Number(g.discountPct) || 0),
    network,
    fx,
  });
  const status: ResultStatus =
    estimate.netBtcStatus === 'ok' && estimate.periods.day.netNzd != null
      ? { kind: 'estimate' }
      : {
          kind: 'unavailable',
          message:
            estimate.netBtcStatus !== 'ok'
              ? estimate.netBtcMessage ?? estimate.poolRewardMessage
              : fx?.message ?? 'BTC/NZD unavailable',
        };
  const available = status.kind !== 'unavailable';
  const period = (p: 'day' | 'month' | 'year'): MinerPeriod => ({
    nzd: available ? estimate.periods[p].netNzd : null,
    btc: available ? estimate.periods[p].netBtc : null,
  });
  return {
    type: 'miner',
    ths: parsed.ths,
    wPerTh,
    wPerThFrom,
    discountPct: estimate.discountPct,
    periods: { day: period('day'), month: period('month'), year: period('year') },
    liveInputs: [
      {
        label: 'BTC price',
        ok: fx?.status === 'ok',
        detail: fx?.status === 'ok' ? sourceName(fx.source, 'miner') : fx?.message ?? 'not loaded',
      },
      {
        label: 'GoMining pool income',
        ok: income != null,
        detail: income ? sourceName(g.income?.source, 'miner') : g.income?.message ?? 'not loaded',
      },
      {
        label: 'Network hashrate',
        ok: networkHashrateEhs != null,
        detail: networkHashrateEhs != null ? `${networkHashrateEhs} EH/s` : g.networkHashrate?.message ?? 'not loaded',
      },
    ],
    title: `Miner · ${parsed.ths} TH/s`,
    detail: null,
    value: period('day').nzd,
    currency: 'NZD',
    note: 'net per day',
    status,
    source: [sourceName(g.income?.source, 'miner'), fx?.source ? sourceName(fx.source, 'miner') : null]
      .filter(Boolean)
      .join(' · '),
    asOf: g.income?.asOf ?? null,
  };
}

async function lookupDiamond(
  parsed: Extract<ParsedQuery, { type: 'diamond' }>,
  force: boolean,
): Promise<LookupResult> {
  const specs = {
    carat: parsed.carat,
    colour: parsed.colour ?? DIAMOND_DEFAULTS.colour,
    clarity: parsed.clarity ?? DIAMOND_DEFAULTS.clarity,
    shape: parsed.shape ?? DIAMOND_DEFAULTS.shape,
  };
  const assumed = parsed.colour == null || parsed.clarity == null || parsed.shape == null;
  const base = {
    type: 'diamond' as const,
    title: `Diamond · ${specs.carat} ct`,
    detail: `${specs.carat} ct · ${specs.colour} · ${specs.clarity} · ${specs.shape}${
      assumed ? ' (unspecified grades default to G · VS2 · round)' : ''
    }`,
    currency: 'NZD',
    note: 'per stone',
  };
  if (specs.carat < 0.3 || specs.carat > 6) {
    return {
      ...base,
      value: null,
      status: { kind: 'unavailable', message: 'OpenFacet covers 0.3 to 6.0 carat' },
      source: SOURCE_NAME.diamond,
      asOf: null,
    };
  }
  const { quote } = await api.quotes.diamondQuote({ ...specs, force });
  const status = quoteStatus(quote.status, quote.price, quote.message);
  return {
    ...base,
    value: valueIfAvailable(status, quote.price),
    status,
    source: sourceName(quote.source, 'diamond'),
    asOf: quote.asOf,
  };
}

export function runLookup(input: LookupInput, { force }: { force: boolean }): Promise<LookupResult> {
  const { parsed } = input;
  switch (parsed.type) {
    case 'stock':
    case 'crypto':
      return lookupTicker(parsed.symbol, parsed.type);
    case 'mtg':
    case 'pokemon':
      return lookupCard(parsed, input.card);
    case 'metal':
      return lookupMetal(parsed);
    case 'currency':
      return lookupCurrency(parsed, force);
    case 'miner':
      return lookupMiner(parsed, input);
    case 'diamond':
      return lookupDiamond(parsed, force);
  }
}

/** Cache / dedupe key: the parsed query plus only the card inputs its type uses. */
export function lookupKey(input: LookupInput): string {
  const { parsed } = input;
  const extra =
    parsed.type === 'mtg' || parsed.type === 'pokemon'
      ? input.card
      : parsed.type === 'miner'
        ? [input.heldWPerTh, input.miner]
        : null;
  return JSON.stringify([parsed, extra]).toLowerCase();
}
