/**
 * News section planning + RSS parsing.
 * Offline by default. Set NEWS_LIVE=1 to also hit Google News and BBC.
 *
 * Run: node --import tsx server/news/sections.test.ts
 */
import assert from 'node:assert/strict';
import type { NewsHoldingRow } from './sections.ts';
import {
  HOLDINGS_FOR_NEWS_SQL,
  planNewsSections,
} from './sections.ts';
import { clearRssCache, fetchRss, parseRssFeed } from './rss.ts';
import { loadNewsSections } from './load.ts';

const failures: string[] = [];

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log('OK:', name);
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${name}: ${msg}`);
      console.error('FAIL:', name, msg);
    });
}

function row(partial: Partial<NewsHoldingRow> & { asset_class: string }): NewsHoldingRow {
  return {
    name: null,
    symbol: null,
    asset: null,
    exchange: null,
    metal: null,
    miner_name: null,
    artist: null,
    artwork_title: null,
    stone_type: null,
    card_game: null,
    ...partial,
  };
}

const GOOGLE_ITEM = `<?xml version="1.0"?><rss version="2.0"><channel>
<item>
<title>Bitcoin holds near a published level - CNBC</title>
<link>https://news.google.com/rss/articles/fixture-btc</link>
<pubDate>Fri, 02 Oct 2026 14:57:26 GMT</pubDate>
<source url="https://www.cnbc.com">CNBC</source>
</item>
<item>
<title>Bitcoin holds near a published level - CNBC</title>
<link>https://news.google.com/rss/articles/fixture-btc</link>
<pubDate>Fri, 02 Oct 2026 14:57:26 GMT</pubDate>
<source url="https://www.cnbc.com">CNBC</source>
</item>
</channel></rss>`;

const BBC_WORLD = `<?xml version="1.0"?><rss version="2.0"><channel>
<item>
<title><![CDATA[Kyiv bridge hit in a reported drone attack]]></title>
<link>https://www.bbc.co.uk/news/articles/world-fixture</link>
<pubDate>Sun, 04 Oct 2026 03:07:30 GMT</pubDate>
</item>
</channel></rss>`;

const BBC_POLITICS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item>
<title><![CDATA[Minister scraps a published jury-trial plan]]></title>
<link>https://www.bbc.co.uk/news/articles/politics-fixture</link>
<pubDate>Sun, 04 Oct 2026 04:07:30 GMT</pubDate>
</item>
</channel></rss>`;

function ids(rows: NewsHoldingRow[]): string[] {
  return planNewsSections(rows).map((section) => section.id);
}

function feedQuery(url: string | undefined): string {
  if (!url) return '';
  return new URL(url).searchParams.get('q') ?? '';
}

await check('sql is scoped to the session user', () => {
  assert.match(HOLDINGS_FOR_NEWS_SQL, /WHERE user_id = \?/);
  assert.equal(HOLDINGS_FOR_NEWS_SQL.match(/FROM holdings/g)?.length, 1);
  assert.doesNotMatch(HOLDINGS_FOR_NEWS_SQL, /user_id IS NULL/);
});

await check('stocks only omit crypto, forex, and metals', () => {
  assert.deepEqual(
    ids([row({ asset_class: 'stock', symbol: 'AAPL', name: 'Apple' })]),
    ['stock', 'world'],
  );
});

await check('metals only omit crypto', () => {
  assert.deepEqual(
    ids([row({ asset_class: 'metal', metal: 'gold', name: 'Gold bar' })]),
    ['metal', 'world'],
  );
});

await check('empty holdings are world news only', () => {
  const plans = planNewsSections([]);
  assert.deepEqual(plans.map((s) => s.id), ['world']);
  assert.equal(plans[0]?.kind, 'world');
  assert.ok(plans[0]?.feeds.every((feed) => feed.url.includes('bbci.co.uk')));
});

await check('two users do not share section plans', () => {
  const a = planNewsSections([
    row({ asset_class: 'crypto', asset: 'BTC', name: 'Bitcoin' }),
    row({ asset_class: 'stock', symbol: 'AAPL', name: 'Apple' }),
  ]);
  const b = planNewsSections([
    row({ asset_class: 'forex', asset: 'EUR', name: 'Euro cash' }),
  ]);
  assert.deepEqual(a.map((s) => s.id), ['stock', 'crypto', 'world']);
  assert.deepEqual(b.map((s) => s.id), ['forex', 'world']);
  const aText = JSON.stringify(a);
  assert.equal(aText.includes('EUR'), false);
  assert.equal(JSON.stringify(b).includes('AAPL'), false);
  assert.equal(JSON.stringify(b).includes('BTC'), false);
});

await check('held classes all open, including forex and metals', () => {
  const plans = planNewsSections([
    row({ asset_class: 'crypto', asset: 'ETH', name: 'Ether' }),
    row({ asset_class: 'forex', asset: 'USD', name: 'USD' }),
    row({ asset_class: 'metal', metal: 'silver', name: 'Silver' }),
    row({ asset_class: 'gomining_miner', miner_name: 'Office miner', name: 'Office miner' }),
    row({ asset_class: 'real_estate', name: '42 Private Road' }),
    row({ asset_class: 'collectable', card_game: 'mtg', name: 'Black Lotus' }),
  ]);
  assert.deepEqual(
    plans.map((s) => s.id),
    ['crypto', 'gomining', 'forex', 'metal', 'real_estate', 'collectable', 'world'],
  );
});

await check('stock search uses the company, not another ticker', () => {
  const [stock] = planNewsSections([
    row({
      asset_class: 'stock',
      symbol: 'FPH',
      exchange: 'NZX',
      name: 'Fisher & Paykel Healthcare',
    }),
  ]);
  const url = stock?.feeds[0]?.url ?? '';
  const query = feedQuery(url);
  assert.match(url, /news\.google\.com/);
  assert.match(query, /Fisher & Paykel Healthcare/);
  assert.match(query, /FPH\.NZ/);
  assert.doesNotMatch(query, /AAPL/);
});

await check('private miner nicknames and addresses stay out of the query', () => {
  const plans = planNewsSections([
    row({
      asset_class: 'gomining_miner',
      miner_name: 'Secret nickname 123',
      name: 'Secret nickname 123',
    }),
    row({ asset_class: 'real_estate', name: '42 Private Road Auckland' }),
  ]);
  const mining = plans.find((s) => s.id === 'gomining');
  const property = plans.find((s) => s.id === 'real_estate');
  const miningUrl = feedQuery(mining?.feeds[0]?.url);
  const propertyUrl = feedQuery(property?.feeds[0]?.url);
  assert.match(miningUrl, /Bitcoin mining|GoMining/);
  assert.doesNotMatch(miningUrl, /Secret nickname/);
  assert.match(mining?.matched.join(' ') ?? '', /Secret nickname/);
  assert.match(propertyUrl, /New Zealand/);
  assert.doesNotMatch(propertyUrl, /Private Road/);
  assert.match(property?.matched.join(' ') ?? '', /Private Road/);
});

await check('rss parser keeps real items and drops non-feeds', () => {
  const parsed = parseRssFeed(GOOGLE_ITEM);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0]?.title, 'Bitcoin holds near a published level');
  assert.equal(parsed.items[0]?.publisher, 'CNBC');
  assert.equal(parsed.items[0]?.url, 'https://news.google.com/rss/articles/fixture-btc');
  assert.equal(parsed.items[0]?.publishedAt, '2026-10-02T14:57:26.000Z');

  const bbc = parseRssFeed(BBC_WORLD);
  assert.equal(bbc.ok, true);
  if (!bbc.ok) return;
  assert.equal(bbc.items[0]?.title, 'Kyiv bridge hit in a reported drone attack');

  const junk = parseRssFeed('<html><title>Not a feed</title></html>');
  assert.equal(junk.ok, false);

  const empty = parseRssFeed('<rss version="2.0"><channel></channel></rss>');
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.items.length, 0);
});

await check('failed feeds produce an error and no stories', async () => {
  clearRssCache();
  const plans = planNewsSections([row({ asset_class: 'crypto', asset: 'BTC', name: 'Bitcoin' })]);
  const sections = await loadNewsSections(plans, {
    fetchImpl: async () => new Response('<html>upstream down</html>', { status: 503 }),
  });
  const crypto = sections.find((s) => s.id === 'crypto');
  const world = sections.find((s) => s.id === 'world');
  assert.equal(crypto?.status, 'error');
  assert.deepEqual(crypto?.items, []);
  assert.match(crypto?.message ?? '', /HTTP 503/);
  assert.equal(world?.status, 'error');
  assert.deepEqual(world?.items, []);
});

await check('successful feeds keep source stories and skip unheld classes', async () => {
  clearRssCache();
  const urls: string[] = [];
  const plans = planNewsSections([
    row({ asset_class: 'stock', symbol: 'AAPL', name: 'Apple' }),
  ]);
  const sections = await loadNewsSections(plans, {
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('bbci.co.uk/news/world')) {
        return new Response(BBC_WORLD, { status: 200, headers: { 'content-type': 'text/xml' } });
      }
      if (url.includes('bbci.co.uk/news/politics')) {
        return new Response(BBC_POLITICS, { status: 200, headers: { 'content-type': 'text/xml' } });
      }
      return new Response(GOOGLE_ITEM, { status: 200, headers: { 'content-type': 'application/xml' } });
    },
  });
  assert.deepEqual(sections.map((s) => s.id), ['stock', 'world']);
  const stock = sections.find((s) => s.id === 'stock');
  assert.equal(stock?.status, 'ok');
  assert.equal(stock?.items.length, 1);
  assert.equal(stock?.items[0]?.publisher, 'CNBC');
  assert.equal(stock?.items[0]?.sourceName, 'Google News');
  const world = sections.find((s) => s.id === 'world');
  assert.equal(world?.status, 'ok');
  assert.deepEqual(
    world?.items.map((item) => item.topic),
    ['World', 'Politics'],
  );
  assert.ok(urls.every((url) => !url.toLowerCase().includes('crypto')));
});

await check('non-xml 200 is an error, not an empty success', async () => {
  const result = await fetchRss('https://example.test/not-rss', {
    fetchImpl: async () => new Response('<html>login</html>', { status: 200 }),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /did not return a feed/);
});

if (process.env.NEWS_LIVE === '1') {
  await check('live Google News and BBC feeds return real headlines', async () => {
    clearRssCache();
    const plans = planNewsSections([
      row({ asset_class: 'crypto', asset: 'BTC', name: 'Bitcoin' }),
      row({ asset_class: 'stock', symbol: 'AAPL', name: 'Apple' }),
    ]);
    const sections = await loadNewsSections(plans);
    for (const id of ['crypto', 'stock', 'world']) {
      const section = sections.find((s) => s.id === id);
      assert.ok(section, `missing ${id}`);
      assert.equal(section?.status, 'ok', `${id} ${section?.message}`);
      assert.ok((section?.items.length ?? 0) > 0, `${id} had no items`);
      for (const item of section?.items ?? []) {
        assert.ok(item.title.trim().length > 0);
        assert.ok(item.url.startsWith('http'));
        assert.ok(item.sourceName === 'Google News' || item.sourceName === 'BBC News');
      }
      console.log(
        'LIVE',
        id,
        section?.items[0]?.publisher ?? section?.items[0]?.sourceName,
        section?.items[0]?.title,
      );
    }
    const world = sections.find((s) => s.id === 'world');
    assert.ok(world?.items.some((item) => item.topic === 'World'));
    assert.ok(world?.items.some((item) => item.topic === 'Politics'));
    assert.equal(sections.some((s) => s.id === 'forex'), false);
    assert.equal(sections.some((s) => s.id === 'metal'), false);
  });
}

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nnews checks passed');
