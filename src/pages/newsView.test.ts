/**
 * News page view rules: tabs, chips, day groups, holding rows, price grouping.
 * Headlines and prices in these fixtures are the inputs. The helpers do not invent any.
 * Run: npm run test:news
 */
import { formatNzd } from '../api/client.ts';
import { setMoneyHidden } from '../lib/privacy.tsx';
import type { Holding } from '../lib/holdingDisplay.ts';
import type { NewsSection, NewsStory } from '../types/index.ts';
import {
  annotateStories,
  aucklandClock,
  countUnread,
  dayHeading,
  groupByDay,
  holdingNewsRows,
  isClosedPosition,
  isDailyPriceUpdate,
  newsSubtitle,
  newsTabs,
  selectStories,
  storyCountLabel,
  storyMeta,
} from './newsView.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

setMoneyHidden(false);

function story(partial: Partial<NewsStory> & Pick<NewsStory, 'title' | 'url'>): NewsStory {
  return {
    publisher: null,
    publishedAt: null,
    sourceName: 'Google News',
    topic: null,
    ...partial,
  };
}

function holding(partial: Partial<Holding> & Pick<Holding, 'id' | 'assetClass' | 'name'>): Holding {
  const { costBasisNzd, ...rest } = partial;
  return { ...rest, costBasisNzd: costBasisNzd ?? null };
}

function section(partial: Partial<NewsSection> & Pick<NewsSection, 'id' | 'items'>): NewsSection {
  return {
    title: partial.id,
    kind: partial.id === 'world' ? 'world' : 'holdings',
    matched: [],
    matchedCount: 0,
    status: 'ok',
    message: null,
    sources: [],
    ...partial,
  };
}

const now = new Date('2026-10-11T02:00:00.000Z'); // Sun 11 Oct 2026, 15:00 Auckland (NZDT)

assert(dayHeading('2026-10-11T01:00:00.000Z', now) === 'TODAY · SUN 11 OCT', 'a headline from today is labelled today');
assert(
  dayHeading('2026-10-10T02:00:00.000Z', now) === 'YESTERDAY · SAT 10 OCT',
  'the previous Auckland day is yesterday',
);
assert(dayHeading('2026-10-09T02:00:00.000Z', now) === 'FRI 9 OCT', 'an older day in this year has no year');
assert(dayHeading('2025-10-11T02:00:00.000Z', now).endsWith('2025'), 'a different year keeps the year');
assert(aucklandClock('2026-10-10T14:17:00.000Z') === '3:17 am', 'clocks are Auckland time');
assert(newsSubtitle(22, '2026-10-10T14:17:00.000Z') === '22 unread · updated 3:17 am · Google News & BBC', 'the subtitle counts unread headlines');
assert(newsSubtitle(0, null) === 'All read · updated — · Google News & BBC', 'a missing fetch time is a dash');

assert(isDailyPriceUpdate('Bitcoin Falls Below $83,000'), 'a price move with an amount is a price update');
assert(isDailyPriceUpdate('Gold & Silver Prices Surge in Delhi'), 'a price surge is a price update');
assert(!isDailyPriceUpdate('Better Cryptocurrency to Buy Now With $1,000: Chainlink vs XRP'), 'a buy article is not a price update');
assert(!isDailyPriceUpdate('Pokémon card values are soaring'), 'a values piece without a price move is not grouped');

assert(isClosedPosition(holding({ id: 's', assetClass: 'stock', name: 'Tesla', shares: 0 })), 'zero shares is closed');
assert(!isClosedPosition(holding({ id: 's2', assetClass: 'stock', name: 'Apple' })), 'a missing share count is not closed');
assert(isClosedPosition(holding({ id: 'c', assetClass: 'crypto', name: 'Doge', amount: 0 })), 'zero crypto is closed');
assert(!isClosedPosition(holding({ id: 'm', assetClass: 'gomining_miner', name: 'Miner' })), 'a miner is not a closed quantity');

const btc = holding({ id: 'btc', assetClass: 'crypto', name: 'Bitcoin', asset: 'BTC', amount: 0.000945 });
const xrp = holding({ id: 'xrp', assetClass: 'crypto', name: 'XRP', asset: 'XRP' });
const spcx = holding({ id: 'spcx', assetClass: 'stock', name: 'SpaceX', symbol: 'SPCX', shares: 2, unitPriceNzd: 85.97 });
const sold = holding({ id: 'sold', assetClass: 'stock', name: 'Sold Co', symbol: 'SOLD', shares: 0, unitPriceNzd: 1 });
const silverA = holding({ id: 'ag1', assetClass: 'metal', name: 'Bar', metal: 'silver', amount: 10, marketValueNzd: 40 });
const silverB = holding({ id: 'ag2', assetClass: 'metal', name: 'Coin', metal: 'silver', amount: 3, marketValueNzd: 75.61 });
const mtg = holding({
  id: 'card',
  assetClass: 'collectable',
  name: 'Black Lotus',
  cardGame: 'mtg',
  quantity: 550,
  marketValueNzd: 901.76,
});
const holdings = [spcx, sold, btc, xrp, silverA, silverB, mtg];

const xrpStory = story({
  title: 'Update for XRP Traders: Bitcoin Trader Explains a Ledger Story',
  url: 'https://news.example/xrp',
  publisher: 'Bitget',
  publishedAt: '2026-10-10T08:24:00.000Z',
});
const btcStory = story({
  title: 'Bitcoin Falls Below $83,000 as markets slip',
  url: 'https://news.example/btc',
  publisher: 'TradingKey',
  publishedAt: '2026-10-10T08:04:00.000Z',
});
const btcStory2 = story({
  title: 'Bitcoin price drops 4% in late trade',
  url: 'https://news.example/btc2',
  publisher: 'WSJ',
  publishedAt: '2026-10-10T07:00:00.000Z',
});
const worldStory = story({
  title: 'Kyiv bridge hit in a reported drone attack',
  url: 'https://news.example/world',
  publisher: 'BBC News',
  sourceName: 'BBC News',
  topic: 'World',
  publishedAt: '2026-10-10T22:30:00.000Z',
});
const politicsStory = story({
  title: 'Minister scraps a published jury-trial plan',
  url: 'https://news.example/politics',
  publisher: 'BBC News',
  sourceName: 'BBC News',
  topic: 'Politics',
  publishedAt: '2026-10-10T21:00:00.000Z',
});
const cardStory = story({
  title: 'Pokémon card values are soaring. What collectors should know',
  url: 'https://news.example/cards',
  publisher: 'CNBC',
  publishedAt: '2026-10-10T13:30:00.000Z',
});
const silverStory = story({
  title: 'Gold & Silver Prices Surge in Delhi',
  url: 'https://news.example/silver',
  publisher: 'Rediff',
  publishedAt: '2026-10-09T02:00:00.000Z',
});

const sections = [
  section({ id: 'stock', title: 'Stocks', items: [] }),
  section({ id: 'crypto', title: 'Crypto', items: [xrpStory, btcStory, btcStory2] }),
  section({ id: 'metal', title: 'Metals', items: [silverStory] }),
  section({ id: 'collectable', title: 'Collectables', items: [cardStory] }),
  section({ id: 'world', title: 'World & politics', kind: 'world', items: [worldStory, politicsStory] }),
];

const annotated = annotateStories(sections, holdings, false);
const byUrl = new Map(annotated.map((item) => [item.story.url, item]));
assert(byUrl.get(xrpStory.url)?.chip === 'XRP', 'an XRP headline is chipped XRP');
assert(byUrl.get(xrpStory.url)?.rowKeys.includes('holding:xrp') === true, 'the XRP headline counts for XRP');
assert(byUrl.get(xrpStory.url)?.rowKeys.includes('holding:btc') === true, 'a headline that also says Bitcoin counts for BTC');
assert(byUrl.get(btcStory.url)?.chip === 'BTC', 'a Bitcoin headline is chipped BTC');
assert(byUrl.get(worldStory.url)?.tab === 'world' && byUrl.get(worldStory.url)?.chip === 'World', 'BBC world stays on the World tab');
assert(byUrl.get(politicsStory.url)?.tab === 'politics' && byUrl.get(politicsStory.url)?.chip === 'Politics', 'BBC politics is its own tab');
assert(byUrl.get(cardStory.url)?.chip === 'MTG', 'the only collectable game labels that section');
assert(byUrl.get(cardStory.url)?.rowKeys[0] === 'card:mtg', 'collectable stories count toward the game');
assert(byUrl.get(silverStory.url)?.chip === 'Silver', 'the only metal labels that section');
assert(storyMeta(xrpStory) === 'Bitget · 9:24 pm', 'a row shows source and Auckland time');

const read = new Set([xrpStory.url]);
const saved = new Set([cardStory.url]);
assert(countUnread(annotated, read, 'all', saved) === annotated.length - 1, 'read headlines drop out of the unread count');
assert(countUnread(annotated, read, 'saved', saved) === 1, 'a saved unread headline still counts on Saved');
assert(selectStories(annotated, 'saved', saved).length === 1, 'Saved shows only saved headlines');
assert(selectStories(annotated, 'politics', saved).every((item) => item.tab === 'politics'), 'a tab shows its own headlines');

const tabs = newsTabs(sections, holdings, false);
assert(tabs[0]?.id === 'all' && tabs[1]?.id === 'saved', 'All and Saved lead the bar');
assert(tabs.some((tab) => tab.id === 'stock'), 'an open stock opens a Stocks tab');
assert(!tabs.some((tab) => tab.label === 'Sold Co'), 'closed names are not tabs');
assert(tabs.some((tab) => tab.id === 'world') && tabs.some((tab) => tab.id === 'politics'), 'World and Politics are always there');
assert(!newsTabs([], [], false).some((tab) => tab.id === 'crypto'), 'an empty book has no Crypto tab');

const rows = holdingNewsRows(holdings, annotated, false);
assert(!rows.some((row) => row.ticker === 'SOLD'), 'a closed stock stays off By holding');
const withClosed = holdingNewsRows(holdings, annotated, true);
assert(withClosed.some((row) => row.ticker === 'SOLD'), 'Include closed positions brings it back');
const space = rows.find((row) => row.ticker === 'SPCX');
assert(space?.detail === `SpaceX · ${formatNzd(85.97)}`, 'a stock shows its unit price');
assert(space?.stories === 0, 'a stock with no matching headline has no stories');
assert(storyCountLabel(0) === 'No stories', 'zero is No stories');
assert(storyCountLabel(1) === '1 story', 'one stays singular');
const xrpRow = rows.find((row) => row.ticker === 'XRP');
assert(xrpRow?.detail === 'XRP', 'a crypto line with no amount omits a made-up price');
assert((xrpRow?.stories ?? 0) >= 1, 'XRP counts the headline that names it');
const btcRow = rows.find((row) => row.ticker === 'BTC');
assert(btcRow?.detail === 'Bitcoin · 0.000945', 'crypto shows the amount on the account');
const silver = rows.find((row) => row.ticker === 'Silver');
assert(silver?.detail === `2 holdings · ${formatNzd(115.61)}`, 'silver holdings are one row with their total');
assert(silver?.stories === 1, 'the silver headline counts once for the metal');
const cards = rows.find((row) => row.ticker === 'MTG');
assert(cards?.detail === `550 cards · ${formatNzd(901.76)}`, 'cards sum the recorded quantity');
const missingPrice = holdingNewsRows(
  [holding({ id: 'q', assetClass: 'stock', name: 'Quiet Co', symbol: 'QYL', shares: 1 })],
  [],
  false,
);
assert(missingPrice[0]?.detail === 'Quiet Co · —', 'a stock with no price shows a dash');
const partialMetal = holdingNewsRows(
  [
    holding({ id: 'g1', assetClass: 'metal', name: 'A', metal: 'gold', amount: 1, marketValueNzd: 10 }),
    holding({ id: 'g2', assetClass: 'metal', name: 'B', metal: 'gold', amount: 1 }),
  ],
  [],
  false,
);
assert(partialMetal[0]?.detail === '2 holdings · —', 'a metal total stays a dash when one value is missing');

const grouped = groupByDay(annotated, now, true);
const saturday = grouped.find((group) => group.heading === 'YESTERDAY · SAT 10 OCT');
assert(saturday != null, 'Saturday headlines sit under yesterday');
const priceEntry = saturday?.entries.find((entry) => entry.kind === 'prices');
assert(priceEntry != null && priceEntry.kind === 'prices' && priceEntry.more.length === 1, 'two Bitcoin price updates on one day collapse');
assert(priceEntry != null && priceEntry.kind === 'prices' && priceEntry.lead.story.url === btcStory.url, 'the newer price update stays visible');
assert(
  Boolean(saturday?.entries.some((entry) => entry.kind === 'story' && entry.story.story.url === xrpStory.url)),
  'a headline that is not a price update stays on its own',
);
const flat = groupByDay(annotated, now, false);
const flatSaturday = flat.find((group) => group.heading === 'YESTERDAY · SAT 10 OCT');
assert(
  (flatSaturday?.entries.filter((entry) => entry.kind === 'story').length ?? 0) === 3,
  'turning grouping off lists every headline',
);
assert(grouped.some((group) => group.heading === 'FRI 9 OCT'), 'older headlines keep their day');
assert(Boolean(grouped[0]?.heading.startsWith('TODAY')), 'the newest day is first');

console.log('news view ok');
