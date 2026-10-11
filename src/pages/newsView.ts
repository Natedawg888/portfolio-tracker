/**
 * Pure view helpers for the News page.
 * Headlines, prices, and counts come from the feed and holdings APIs.
 * These functions only choose labels, grouping, and which rows to show.
 */
import { formatNzd } from '../api/client';
import { displayName, formatAmount, marketValueNzd, type Holding } from '../lib/holdingDisplay';
import type { NewsSection, NewsStory } from '../types';

const ZONE = 'Pacific/Auckland';

const CLASS_TABS: Array<{ id: string; label: string; assetClass: string; chip: string }> = [
  { id: 'stock', label: 'Stocks', assetClass: 'stock', chip: 'Stocks' },
  { id: 'crypto', label: 'Crypto', assetClass: 'crypto', chip: 'Crypto' },
  { id: 'gomining', label: 'GoMining', assetClass: 'gomining_miner', chip: 'GoMining' },
  { id: 'metal', label: 'Metals', assetClass: 'metal', chip: 'Metals' },
  { id: 'collectable', label: 'Collectables', assetClass: 'collectable', chip: 'Collectables' },
  { id: 'forex', label: 'Currencies', assetClass: 'forex', chip: 'Currencies' },
  { id: 'real_estate', label: 'Real estate', assetClass: 'real_estate', chip: 'Property' },
  { id: 'art', label: 'Art', assetClass: 'art', chip: 'Art' },
  { id: 'stone', label: 'Precious stones', assetClass: 'stone', chip: 'Stones' },
];

const CLASS_BY_SECTION = new Map(CLASS_TABS.map((tab) => [tab.id, tab]));

/** Spoken names so a "Bitcoin" headline can match a holding stored as BTC. */
const CRYPTO_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  XRP: 'XRP',
  SOL: 'Solana',
  ADA: 'Cardano',
  DOGE: 'Dogecoin',
  LINK: 'Chainlink',
  LTC: 'Litecoin',
  BCH: 'Bitcoin Cash',
  GMT: 'GoMining',
};

const MOVE_WORD =
  /\b(falls?|fell|drops?|dropped|surges?|surged|rallies|rallied|rebounds?|rebounded|soars?|soared|plunges?|plunged|slides?|slid|jumps?|jumped|climbs?|climbed|gains?|gained|loses?|lost|weakens?|weakened|tumbles?|tumbled|spikes?|spiked)\b/i;
const MONEY_OR_PRICE = /(?:NZ\$|US\$|A\$|\$)\s?\d|\b(price|prices|priced)\b|\b\d+(?:\.\d+)?\s?%/i;

export type NewsTab = { id: string; label: string };

export type StoryView = {
  story: NewsStory;
  sectionId: string;
  tab: string;
  chip: string;
  /** Sidebar rows this headline counts toward. Empty when it cannot be matched. */
  rowKeys: string[];
  priceUpdate: boolean;
};

export type FeedEntry =
  | { kind: 'story'; story: StoryView }
  | { kind: 'prices'; id: string; lead: StoryView; more: StoryView[] };

export type DayGroup = {
  key: string;
  heading: string;
  entries: FeedEntry[];
};

export type HoldingNewsRow = {
  key: string;
  ticker: string;
  detail: string;
  stories: number;
  tab: string;
};

export function isClosedPosition(h: Pick<Holding, 'assetClass' | 'shares' | 'amount' | 'quantity'>): boolean {
  const qty =
    h.assetClass === 'stock'
      ? h.shares
      : h.assetClass === 'crypto' || h.assetClass === 'forex' || h.assetClass === 'metal'
        ? h.amount
        : h.assetClass === 'collectable'
          ? (h.quantity ?? h.amount)
          : null;
  if (qty == null) return false;
  const n = Number(qty);
  return Number.isFinite(n) && n <= 0;
}

export function isDailyPriceUpdate(title: string): boolean {
  const text = title.trim();
  if (!text) return false;
  return MOVE_WORD.test(text) && MONEY_OR_PRICE.test(text);
}

export function storyCountLabel(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'No stories';
  if (n === 1) return '1 story';
  return `${Math.floor(n)} stories`;
}

export function aucklandClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const raw = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return raw.replace(/\s+/g, ' ').toLowerCase();
}

export function newsSubtitle(unread: number, fetchedAt: string | null | undefined): string {
  const head = unread <= 0 ? 'All read' : `${unread} unread`;
  const clock = fetchedAt ? aucklandClock(fetchedAt) : null;
  return `${head} · ${clock ? `updated ${clock}` : 'updated —'} · Google News & BBC`;
}

export function storyMeta(story: NewsStory): string {
  const source = story.publisher?.trim() || story.sourceName;
  const clock = aucklandClock(story.publishedAt);
  return clock ? `${source} · ${clock}` : source;
}

function aucklandYmd(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  if (!year || !month || !day) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${mm}-${dd}`;
}

export function dayHeading(iso: string, now: Date): string {
  const date = new Date(iso);
  const ymd = aucklandYmd(date);
  const today = aucklandYmd(now);
  if (!ymd || !today) return 'NO DATE';
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const label = `${get('weekday')} ${get('day')} ${get('month')}`.toUpperCase();
  if (ymd === today) return `TODAY · ${label}`;
  if (ymd === shiftYmd(today, -1)) return `YESTERDAY · ${label}`;
  if (get('year') !== today.slice(0, 4)) return `${label} ${get('year')}`;
  return label;
}

function mentions(title: string, term: string): boolean {
  const trimmed = term.trim();
  if (trimmed.length < 3) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(title);
}

function collectableChip(h: Holding): string {
  const game = (h.cardGame ?? '').trim().toLowerCase();
  if (game === 'mtg' || game.includes('magic')) return 'MTG';
  if (game.includes('pokemon') || game.includes('pokémon')) return 'Pokemon';
  const name = (h.cardGame ?? h.name ?? 'Card').trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Card';
}

function metalChip(h: Holding): string {
  const raw = (h.metal || h.name || 'Metal').trim();
  if (!raw) return 'Metal';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function chipForHolding(h: Holding): string {
  if (h.assetClass === 'gomining_miner') return 'GoMining';
  if (h.assetClass === 'metal') return metalChip(h);
  if (h.assetClass === 'collectable') return collectableChip(h);
  if (h.assetClass === 'stock') return (h.symbol || h.name || 'Stock').toUpperCase();
  if (h.assetClass === 'crypto') return (h.asset || h.name || 'Crypto').toUpperCase();
  if (h.assetClass === 'forex') return (h.currency || h.asset || h.name || 'FX').toUpperCase();
  if (h.assetClass === 'real_estate') return 'Property';
  if (h.assetClass === 'art') return 'Art';
  if (h.assetClass === 'stone') return (h.stoneType || 'Stone').slice(0, 12);
  return h.name.slice(0, 12);
}

export function rowKeyFor(h: Holding): string {
  if (h.assetClass === 'metal') return `metal:${(h.metal || h.name || 'metal').trim().toLowerCase()}`;
  if (h.assetClass === 'collectable') return `card:${collectableChip(h).toLowerCase()}`;
  return `holding:${h.id}`;
}

function termsFor(h: Holding): string[] {
  const terms: string[] = [];
  const add = (value: string | null | undefined) => {
    const text = (value ?? '').trim();
    if (text.length >= 3 && !terms.some((term) => term.toLowerCase() === text.toLowerCase())) terms.push(text);
  };
  if (h.assetClass === 'stock') {
    add(h.symbol);
    add(h.name);
  } else if (h.assetClass === 'crypto') {
    const ticker = (h.asset || '').trim().toUpperCase();
    add(ticker);
    add(h.name);
    add(CRYPTO_NAMES[ticker]);
  } else if (h.assetClass === 'metal') {
    add(h.metal);
    add(h.name);
  } else if (h.assetClass === 'collectable') {
    add(h.name);
    const game = (h.cardGame ?? '').toLowerCase();
    if (game === 'mtg' || game.includes('magic')) {
      add('Magic: The Gathering');
      add('MTG');
    } else if (game.includes('pokemon') || game.includes('pokémon')) {
      add('Pokemon');
      add('Pokémon');
    } else {
      add(h.cardGame);
    }
  } else if (h.assetClass === 'gomining_miner') {
    add(h.minerName);
    if ((h.name ?? '').trim().toLowerCase() !== 'gomining') add(h.name);
  } else if (h.assetClass === 'forex') {
    add(h.currency);
    add(h.asset);
    add(h.name);
  } else {
    add(h.name);
    add(h.artist);
    add(h.artworkTitle);
    add(h.stoneType);
  }
  return terms;
}

function sectionChip(sectionId: string, title: string): string {
  return CLASS_BY_SECTION.get(sectionId)?.chip ?? title;
}

function assetClassForSection(sectionId: string): string | null {
  return CLASS_BY_SECTION.get(sectionId)?.assetClass ?? null;
}

type Hit = { holding: Holding; term: string; index: number };

function hitsFor(title: string, holdings: Holding[]): Hit[] {
  const hits: Hit[] = [];
  for (const holding of holdings) {
    for (const term of termsFor(holding)) {
      if (!mentions(title, term)) continue;
      const index = title.toLowerCase().indexOf(term.toLowerCase());
      hits.push({ holding, term, index: index < 0 ? title.length : index });
    }
  }
  return hits;
}

function bestHit(hits: Hit[]): Hit | null {
  if (hits.length === 0) return null;
  return [...hits].sort((a, b) => a.index - b.index || b.term.length - a.term.length)[0] ?? null;
}

export function annotateStories(
  sections: NewsSection[],
  holdings: Holding[],
  includeClosed: boolean,
): StoryView[] {
  const open = holdings.filter((holding) => includeClosed || !isClosedPosition(holding));
  const out: StoryView[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const assetClass = assetClassForSection(section.id);
    const pool = assetClass ? open.filter((holding) => holding.assetClass === assetClass) : [];
    const keys = [...new Set(pool.map(rowKeyFor))];
    const sole = keys.length === 1 ? keys[0] : null;
    const soleChip = sole
      ? chipForHolding(pool.find((holding) => rowKeyFor(holding) === sole) ?? pool[0])
      : null;
    for (const story of section.items) {
      if (!story.url || seen.has(story.url)) continue;
      seen.add(story.url);
      if (section.kind === 'world' || section.id === 'world') {
        const topic = story.topic?.trim() || 'World';
        const politics = topic.toLowerCase() === 'politics';
        out.push({
          story,
          sectionId: section.id,
          tab: politics ? 'politics' : 'world',
          chip: politics ? 'Politics' : topic,
          rowKeys: [],
          priceUpdate: isDailyPriceUpdate(story.title),
        });
        continue;
      }
      const hits = hitsFor(story.title, pool);
      const primary = bestHit(hits);
      const matchedKeys = [...new Set(hits.map((hit) => rowKeyFor(hit.holding)))];
      const rowKeys = matchedKeys.length > 0 ? matchedKeys : sole ? [sole] : [];
      const chip = primary ? chipForHolding(primary.holding) : soleChip ?? sectionChip(section.id, section.title);
      out.push({
        story,
        sectionId: section.id,
        tab: section.id,
        chip,
        rowKeys,
        priceUpdate: isDailyPriceUpdate(story.title),
      });
    }
  }
  return out;
}

export function newsTabs(sections: Array<Pick<NewsSection, 'id' | 'title'>>, holdings: Holding[], includeClosed: boolean): NewsTab[] {
  const open = holdings.filter((holding) => includeClosed || !isClosedPosition(holding));
  const sectionIds = new Set(sections.map((section) => section.id));
  const tabs: NewsTab[] = [
    { id: 'all', label: 'All' },
    { id: 'saved', label: 'Saved' },
  ];
  for (const def of CLASS_TABS) {
    if (open.some((holding) => holding.assetClass === def.assetClass) || sectionIds.has(def.id)) {
      tabs.push({ id: def.id, label: def.label });
    }
  }
  for (const section of sections) {
    if (section.id === 'world' || CLASS_BY_SECTION.has(section.id) || tabs.some((tab) => tab.id === section.id)) continue;
    tabs.push({ id: section.id, label: section.title });
  }
  tabs.push({ id: 'world', label: 'World' }, { id: 'politics', label: 'Politics' });
  return tabs;
}

export function countUnread(stories: StoryView[], read: ReadonlySet<string>, tab: string, saved: ReadonlySet<string>): number {
  const urls = new Set<string>();
  for (const story of stories) {
    if (tab === 'saved') {
      if (!saved.has(story.story.url)) continue;
    } else if (tab !== 'all' && story.tab !== tab) continue;
    urls.add(story.story.url);
  }
  let unread = 0;
  for (const url of urls) if (!read.has(url)) unread += 1;
  return unread;
}

export function selectStories(
  stories: StoryView[],
  tab: string,
  saved: ReadonlySet<string>,
): StoryView[] {
  if (tab === 'all') return stories;
  if (tab === 'saved') return stories.filter((story) => saved.has(story.story.url));
  return stories.filter((story) => story.tab === tab);
}

function storyTime(story: StoryView): number {
  const t = story.story.publishedAt ? Date.parse(story.story.publishedAt) : NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

export function groupByDay(stories: StoryView[], now: Date, groupPrices: boolean): DayGroup[] {
  const buckets = new Map<string, StoryView[]>();
  const undated: StoryView[] = [];
  for (const story of stories) {
    const iso = story.story.publishedAt;
    const ymd = iso ? aucklandYmd(new Date(iso)) : null;
    if (!iso || !ymd) {
      undated.push(story);
      continue;
    }
    const list = buckets.get(ymd) ?? [];
    list.push(story);
    buckets.set(ymd, list);
  }
  const days = [...buckets.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const groups: DayGroup[] = days.map((ymd) => {
    const list = (buckets.get(ymd) ?? []).slice().sort((a, b) => storyTime(b) - storyTime(a));
    const sample = list.find((story) => story.story.publishedAt)?.story.publishedAt ?? `${ymd}T00:00:00Z`;
    return { key: ymd, heading: dayHeading(sample, now), entries: entriesFor(list, groupPrices, ymd) };
  });
  if (undated.length > 0) {
    groups.push({ key: 'undated', heading: 'NO DATE', entries: entriesFor(undated, groupPrices, 'undated') });
  }
  return groups;
}

function entriesFor(stories: StoryView[], groupPrices: boolean, dayKey: string): FeedEntry[] {
  if (!groupPrices) return stories.map((story) => ({ kind: 'story', story }));
  const used = new Set<string>();
  const out: FeedEntry[] = [];
  for (const story of stories) {
    if (used.has(story.story.url)) continue;
    used.add(story.story.url);
    if (!story.priceUpdate) {
      out.push({ kind: 'story', story });
      continue;
    }
    const more = stories.filter(
      (other) =>
        !used.has(other.story.url) &&
        other.priceUpdate &&
        other.chip === story.chip &&
        other.story.url !== story.story.url,
    );
    for (const extra of more) used.add(extra.story.url);
    if (more.length === 0) out.push({ kind: 'story', story });
    else out.push({ kind: 'prices', id: `${dayKey}:${story.chip}:${story.story.url}`, lead: story, more });
  }
  return out;
}

function moneyOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return formatNzd(value);
}

function completeTotal(rows: Holding[]): number | null {
  let sum = 0;
  for (const holding of rows) {
    const value = marketValueNzd(holding);
    if (value == null || !Number.isFinite(value)) return null;
    sum += value;
  }
  return rows.length > 0 ? sum : null;
}

function holdingDetail(h: Holding): string {
  const name = displayName(h);
  if (h.assetClass === 'crypto') {
    if (h.amount != null && Number.isFinite(Number(h.amount))) return `${name} · ${formatAmount(Number(h.amount))}`;
    if (h.unitPriceNzd != null && Number.isFinite(h.unitPriceNzd)) return `${name} · ${formatNzd(h.unitPriceNzd)}`;
    return name;
  }
  if (h.assetClass === 'stock' || h.assetClass === 'forex') return `${name} · ${moneyOrDash(h.unitPriceNzd)}`;
  if (h.assetClass === 'gomining_miner') return `${name} · ${moneyOrDash(h.estimatedValueNzd)}`;
  return `${name} · ${moneyOrDash(marketValueNzd(h))}`;
}

function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function holdingNewsRows(holdings: Holding[], stories: StoryView[], includeClosed: boolean): HoldingNewsRow[] {
  const open = holdings.filter((holding) => holding.id && (includeClosed || !isClosedPosition(holding)));
  const counts = new Map<string, number>();
  for (const story of stories) {
    for (const key of story.rowKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows: Array<HoldingNewsRow & { index: number }> = [];
  const seen = new Set<string>();
  for (const holding of open) {
    const key = rowKeyFor(holding);
    if (holding.assetClass === 'metal' || holding.assetClass === 'collectable') {
      if (seen.has(key)) continue;
      seen.add(key);
      const group = open.filter((item) => rowKeyFor(item) === key);
      const tab = holding.assetClass === 'metal' ? 'metal' : 'collectable';
      const total = completeTotal(group);
      if (holding.assetClass === 'metal') {
        rows.push({
          key,
          ticker: metalChip(holding),
          detail: `${countLabel(group.length, 'holding', 'holdings')} · ${moneyOrDash(total)}`,
          stories: counts.get(key) ?? 0,
          tab,
          index: rows.length,
        });
      } else {
        let cards = 0;
        let known = false;
        for (const item of group) {
          const qty = item.quantity ?? item.amount;
          if (qty == null || !Number.isFinite(Number(qty))) continue;
          known = true;
          cards += Number(qty);
        }
        const left = known
          ? countLabel(cards, 'card', 'cards')
          : countLabel(group.length, 'holding', 'holdings');
        rows.push({
          key,
          ticker: collectableChip(holding),
          detail: `${left} · ${moneyOrDash(total)}`,
          stories: counts.get(key) ?? 0,
          tab,
          index: rows.length,
        });
      }
      continue;
    }
    const tab = CLASS_TABS.find((item) => item.assetClass === holding.assetClass)?.id ?? holding.assetClass;
    rows.push({
      key,
      ticker: chipForHolding(holding),
      detail: holdingDetail(holding),
      stories: counts.get(key) ?? 0,
      tab,
      index: rows.length,
    });
  }
  const order = new Map(CLASS_TABS.map((tab, index) => [tab.id, index]));
  return rows
    .sort((a, b) => (order.get(a.tab) ?? 99) - (order.get(b.tab) ?? 99) || a.index - b.index)
    .map(({ index: _index, ...row }) => row);
}

export function nextNewsTab(tabs: string[], current: string, key: string): string | null {
  const index = tabs.indexOf(current);
  if (index < 0) return null;
  if (key === 'ArrowRight') return tabs[(index + 1) % tabs.length] ?? null;
  if (key === 'ArrowLeft') return tabs[(index - 1 + tabs.length) % tabs.length] ?? null;
  if (key === 'Home') return tabs[0] ?? null;
  if (key === 'End') return tabs[tabs.length - 1] ?? null;
  return null;
}
