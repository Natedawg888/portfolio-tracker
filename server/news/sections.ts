/**
 * Which news sections to open for one user's holdings.
 * Callers must pass only that user's rows (see HOLDINGS_FOR_NEWS_SQL).
 * Queries are built from those rows. World/politics is always included
 * and is not filtered by holdings.
 */
import { yahooEquitySymbol } from '../quotes/history.ts';

export const HOLDINGS_FOR_NEWS_SQL = `
SELECT asset_class, name, symbol, asset, exchange, metal, miner_name,
       artist, artwork_title, stone_type, card_game
FROM holdings
WHERE user_id = ?
ORDER BY updated_at DESC
`.trim();

export type NewsHoldingRow = {
  asset_class: string;
  name: string | null;
  symbol: string | null;
  asset: string | null;
  exchange: string | null;
  metal: string | null;
  miner_name: string | null;
  artist: string | null;
  artwork_title: string | null;
  stone_type: string | null;
  card_game: string | null;
};

export type NewsFeedSpec = {
  sourceName: string;
  url: string;
  topic?: string;
};

export type NewsSectionPlan = {
  id: string;
  title: string;
  kind: 'holdings' | 'world';
  matched: string[];
  matchedCount: number;
  feeds: NewsFeedSpec[];
};

const GOOGLE_NEWS = 'Google News';
const BBC_NEWS = 'BBC News';

const CLASS_ORDER = [
  'stock',
  'crypto',
  'gomining_miner',
  'forex',
  'metal',
  'real_estate',
  'art',
  'stone',
  'collectable',
] as const;

const CLASS_ORDER_SET = new Set<string>(CLASS_ORDER);

const CLASS_TITLES: Record<string, string> = {
  stock: 'Stocks',
  crypto: 'Crypto',
  gomining_miner: 'GoMining',
  forex: 'Currencies',
  metal: 'Metals',
  real_estate: 'Real estate',
  art: 'Art',
  stone: 'Precious stones',
  collectable: 'Collectables',
};

const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  XRP: 'XRP',
  SOL: 'Solana',
  ADA: 'Cardano',
  DOGE: 'Dogecoin',
  DOT: 'Polkadot',
  AVAX: 'Avalanche',
  LINK: 'Chainlink',
  LTC: 'Litecoin',
  BCH: 'Bitcoin Cash',
  ATOM: 'Cosmos',
  UNI: 'Uniswap',
  XLM: 'Stellar',
  NEAR: 'NEAR',
  APT: 'Aptos',
  ARB: 'Arbitrum',
  OP: 'Optimism',
  SUI: 'Sui',
  TRX: 'TRON',
  TON: 'Toncoin',
  SHIB: 'Shiba Inu',
  USDT: 'Tether',
  USDC: 'USD Coin',
  BNB: 'BNB',
  GMT: 'GoMining',
  GOMINING: 'GoMining',
};

const FX_NAMES: Record<string, string> = {
  AUD: 'Australian dollar',
  CAD: 'Canadian dollar',
  CHF: 'Swiss franc',
  CNY: 'Chinese yuan',
  EUR: 'euro',
  GBP: 'British pound',
  HKD: 'Hong Kong dollar',
  JPY: 'Japanese yen',
  NZD: 'New Zealand dollar',
  SGD: 'Singapore dollar',
  USD: 'US dollar',
  ZAR: 'South African rand',
};

const METAL_TERMS: Record<string, string> = {
  gold: 'gold price',
  silver: 'silver price',
  platinum: 'platinum price',
  palladium: 'palladium price',
};

const QUERY_LIMIT = 6;
const MATCHED_LIMIT = 12;

const BBC_WORLD = 'https://feeds.bbci.co.uk/news/world/rss.xml';
const BBC_POLITICS = 'https://feeds.bbci.co.uk/news/politics/rss.xml';

export function googleNewsSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    hl: 'en-NZ',
    gl: 'NZ',
    ceid: 'NZ:en',
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function pick(raw: Record<string, unknown>, key: string): string | null {
  const v = raw[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function normalizeHoldingRow(raw: Record<string, unknown>): NewsHoldingRow {
  return {
    asset_class: (pick(raw, 'asset_class') ?? '').toLowerCase(),
    name: pick(raw, 'name'),
    symbol: pick(raw, 'symbol'),
    asset: pick(raw, 'asset'),
    exchange: pick(raw, 'exchange'),
    metal: pick(raw, 'metal'),
    miner_name: pick(raw, 'miner_name'),
    artist: pick(raw, 'artist'),
    artwork_title: pick(raw, 'artwork_title'),
    stone_type: pick(raw, 'stone_type'),
    card_game: pick(raw, 'card_game'),
  };
}

function unique(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const t = (value ?? '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Strip characters that would break a Google News search phrase. */
export function searchPhrase(raw: string | null | undefined, max = 80): string {
  if (!raw) return '';
  const cleaned = raw
    .replace(/\bwhen:/gi, ' ')
    .replace(/[^\p{L}\p{N}&.'’:\- ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, max).trim();
}

function phrase(term: string): string {
  const t = term.trim();
  if (!t) return '';
  if (/^[A-Za-z0-9.^=-]{1,16}$/.test(t)) return t;
  return `"${t.replace(/"/g, '')}"`;
}

function orQuery(clauses: string[], tail: string): string {
  const clean = unique(clauses);
  const tailBit = tail.trim();
  let body = '';
  if (clean.length === 0) body = tailBit;
  else if (clean.length === 1) body = tailBit ? `(${clean[0]}) ${tailBit}` : clean[0];
  else {
    const joined = `(${clean.join(') OR (')})`;
    body = tailBit ? `${joined} ${tailBit}` : joined;
  }
  if (body.length > 360) {
    body = body.slice(0, 360).replace(/\s+\S*$/, '').replace(/[("]+$/g, '').trim();
  }
  return `${body} when:14d`.replace(/\s+/g, ' ').trim();
}

function googleFeed(query: string): NewsFeedSpec {
  return { sourceName: GOOGLE_NEWS, url: googleNewsSearchUrl(query) };
}

function sectionIdForClass(assetClass: string): string {
  if (assetClass === 'gomining_miner') return 'gomining';
  const id = assetClass.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!id || id === 'world' || id === 'all') return `asset_${id || 'other'}`;
  return id;
}

function titleForClass(assetClass: string): string {
  return CLASS_TITLES[assetClass] ?? humanize(assetClass);
}

function humanize(assetClass: string): string {
  const s = assetClass.replace(/_/g, ' ').trim();
  if (!s) return 'Holdings';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function capMatched(labels: string[]): { matched: string[]; matchedCount: number } {
  const all = unique(labels);
  return { matched: all.slice(0, MATCHED_LIMIT), matchedCount: all.length };
}

function stockSymbol(row: NewsHoldingRow): string {
  const symbol = (row.symbol || row.asset || '').trim().toUpperCase();
  if (!symbol) return '';
  const ex = (row.exchange ?? '').toUpperCase();
  const exchange =
    ex.includes('NZSE') || ex.includes('NZX') || ex === 'NZ'
      ? 'NZX'
      : ex.includes('ASX') || ex === 'AU'
        ? 'ASX'
        : row.exchange;
  return yahooEquitySymbol(symbol, exchange);
}

function stockQuery(rows: NewsHoldingRow[]): { labels: string[]; query: string } {
  const labels: string[] = [];
  const clauses: string[] = [];
  for (const row of rows) {
    const symbol = stockSymbol(row);
    const bare = (row.symbol || row.asset || '').trim().toUpperCase();
    const name = searchPhrase(row.name);
    const nameUsable = name && name.toUpperCase() !== bare && name.toUpperCase() !== symbol;
    labels.push(nameUsable ? `${name} (${symbol || bare})` : symbol || bare || name);
    const bits = unique([
      nameUsable ? phrase(name) : '',
      symbol ? phrase(symbol) : bare ? phrase(bare) : '',
    ]);
    if (bits.length) clauses.push(bits.join(' OR '));
  }
  const used = clauses.slice(0, QUERY_LIMIT);
  return { labels: unique(labels), query: orQuery(used, '(stock OR shares)') };
}

function cryptoQuery(rows: NewsHoldingRow[]): { labels: string[]; query: string } {
  const labels: string[] = [];
  const clauses: string[] = [];
  for (const row of rows) {
    const ticker = (row.asset || row.symbol || '').trim().toUpperCase();
    const known = ticker ? CRYPTO_NAMES[ticker] : undefined;
    const name = searchPhrase(row.name);
    const nameUsable = name && name.toUpperCase() !== ticker && name.toLowerCase() !== known?.toLowerCase();
    labels.push(known || (nameUsable ? name : ticker || name));
    const bits = unique([
      known ? phrase(known) : nameUsable ? phrase(name) : '',
      ticker ? phrase(ticker) : '',
    ]);
    if (bits.length) clauses.push(bits.join(' OR '));
  }
  return {
    labels: unique(labels),
    query: orQuery(clauses.slice(0, QUERY_LIMIT), '(crypto OR cryptocurrency)'),
  };
}

function forexQuery(rows: NewsHoldingRow[]): { labels: string[]; query: string } {
  const labels: string[] = [];
  const clauses: string[] = [];
  for (const row of rows) {
    const code = (row.asset || row.symbol || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      const name = searchPhrase(row.name);
      if (name) {
        labels.push(name);
        clauses.push(phrase(name));
      }
      continue;
    }
    const spoken = FX_NAMES[code];
    labels.push(spoken ? `${spoken} (${code})` : code);
    clauses.push(spoken ? `${phrase(spoken)} OR ${code}` : code);
  }
  return {
    labels: unique(labels),
    query: orQuery(clauses.slice(0, QUERY_LIMIT), '(currency OR forex)'),
  };
}

function metalQuery(rows: NewsHoldingRow[]): { labels: string[]; query: string } {
  const labels: string[] = [];
  const clauses: string[] = [];
  for (const row of rows) {
    const metal = (row.metal || '').trim().toLowerCase();
    const term = METAL_TERMS[metal];
    if (term) {
      labels.push(metal.charAt(0).toUpperCase() + metal.slice(1));
      clauses.push(phrase(term));
      continue;
    }
    const name = searchPhrase(row.name);
    if (name) {
      labels.push(name);
      clauses.push(phrase(name));
    }
  }
  return {
    labels: unique(labels),
    query: orQuery(clauses.slice(0, QUERY_LIMIT), 'precious metals'),
  };
}

function gominingQuery(rows: NewsHoldingRow[]): { labels: string[]; query: string } {
  const labels = unique(
    rows.map((row) => searchPhrase(row.miner_name) || searchPhrase(row.name) || 'GoMining miner'),
  );
  // Miner nicknames stay on the page. The public query stays on the topic.
  return {
    labels,
    query: orQuery(['GoMining', '"Bitcoin mining"', '"crypto mining"'], ''),
  };
}

function artQuery(rows: NewsHoldingRow[]): { labels: string[]; query: string } {
  const artists = unique(rows.map((row) => searchPhrase(row.artist)));
  const titles = unique(rows.map((row) => searchPhrase(row.artwork_title) || searchPhrase(row.name)));
  if (artists.length) {
    return {
      labels: artists,
      query: orQuery(artists.slice(0, QUERY_LIMIT).map(phrase), '(art OR auction)'),
    };
  }
  return {
    labels: titles.length ? titles : ['Art'],
    query: orQuery([], 'art market auction'),
  };
}

function stoneQuery(rows: NewsHoldingRow[]): { labels: string[]; query: string } {
  const types = unique(rows.map((row) => searchPhrase(row.stone_type) || searchPhrase(row.name)));
  return {
    labels: types.length ? types : ['Precious stones'],
    query: orQuery(
      (types.length ? types : ['precious stones']).slice(0, QUERY_LIMIT).map(phrase),
      '(gemstone OR jewellery OR jewelry)',
    ),
  };
}

function realEstateQuery(rows: NewsHoldingRow[]): { labels: string[]; query: string } {
  const labels = unique(rows.map((row) => searchPhrase(row.name) || 'Property'));
  // Property names can be home addresses. Keep them on-screen only.
  return {
    labels,
    query: orQuery(['"New Zealand" (housing OR "property market")'], ''),
  };
}

function collectableLabel(game: string | null): string | null {
  const g = (game ?? '').trim().toLowerCase();
  if (!g || g === 'other') return null;
  if (g === 'mtg' || g.includes('magic')) return 'Magic: The Gathering';
  if (g.includes('pokemon') || g.includes('pokémon')) return 'Pokemon cards';
  return searchPhrase(game);
}

function collectableQuery(rows: NewsHoldingRow[]): { labels: string[]; query: string } {
  const labels = unique(rows.map((row) => collectableLabel(row.card_game) || searchPhrase(row.name)));
  const terms = labels.length ? labels : ['collectable cards'];
  return {
    labels: labels.length ? labels : ['Collectables'],
    query: orQuery(terms.slice(0, QUERY_LIMIT).map(phrase), 'market OR prices'),
  };
}

function genericQuery(rows: NewsHoldingRow[], assetClass: string): { labels: string[]; query: string } {
  const labels = unique(rows.map((row) => searchPhrase(row.name) || humanize(assetClass)));
  return {
    labels,
    query: orQuery(labels.slice(0, QUERY_LIMIT).map(phrase), humanize(assetClass)),
  };
}

function queryForClass(assetClass: string, rows: NewsHoldingRow[]): { labels: string[]; query: string } {
  switch (assetClass) {
    case 'stock':
      return stockQuery(rows);
    case 'crypto':
      return cryptoQuery(rows);
    case 'forex':
      return forexQuery(rows);
    case 'metal':
      return metalQuery(rows);
    case 'gomining_miner':
      return gominingQuery(rows);
    case 'art':
      return artQuery(rows);
    case 'stone':
      return stoneQuery(rows);
    case 'real_estate':
      return realEstateQuery(rows);
    case 'collectable':
      return collectableQuery(rows);
    default:
      return genericQuery(rows, assetClass);
  }
}

/** BBC world and politics feeds used by the holdings news page. */
export function worldPoliticsFeeds(): NewsFeedSpec[] {
  return [
    { sourceName: BBC_NEWS, url: BBC_WORLD, topic: 'World' },
    { sourceName: BBC_NEWS, url: BBC_POLITICS, topic: 'Politics' },
  ];
}

function worldPlan(): NewsSectionPlan {
  return {
    id: 'world',
    title: 'World & politics',
    kind: 'world',
    matched: [],
    matchedCount: 0,
    feeds: worldPoliticsFeeds(),
  };
}

/**
 * Sections for the supplied holdings only, plus world/politics.
 * An asset class with no rows is omitted (no crypto block without crypto).
 */
export function planNewsSections(rows: NewsHoldingRow[]): NewsSectionPlan[] {
  const groups = new Map<string, NewsHoldingRow[]>();
  for (const row of rows) {
    const key = row.asset_class.trim().toLowerCase();
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const ordered = [
    ...CLASS_ORDER.filter((key) => groups.has(key)),
    ...[...groups.keys()].filter((key) => !CLASS_ORDER_SET.has(key)).sort(),
  ];

  const sections: NewsSectionPlan[] = [];
  for (const assetClass of ordered) {
    const group = groups.get(assetClass) ?? [];
    if (group.length === 0) continue;
    const built = queryForClass(assetClass, group);
    const { matched, matchedCount } = capMatched(built.labels);
    sections.push({
      id: sectionIdForClass(assetClass),
      title: titleForClass(assetClass),
      kind: 'holdings',
      matched,
      matchedCount,
      feeds: [googleFeed(built.query)],
    });
  }
  sections.push(worldPlan());
  return sections;
}
