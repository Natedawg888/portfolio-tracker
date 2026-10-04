/**
 * Phase news uses the shared Google News and BBC feeds.
 * Failed feeds stay empty. Headlines come only from the feed body.
 * Run: npm run test:economy
 */
import assert from 'node:assert/strict';
import { parseRssFeed } from '../news/rss.ts';
import { PHASE_NEWS_NOTE, loadPhaseNews, planPhaseNewsFeeds } from './phaseNews.ts';

const feeds = planPhaseNewsFeeds('recession');
const ids = feeds.map((feed) => feed.id);
assert.deepEqual(ids, ['phase', 'rates', 'gdp', 'inflation', 'unemployment', 'housing', 'global', 'world', 'politics']);

for (const feed of feeds) {
  if (feed.sourceName === 'Google News') {
    assert.match(feed.url, /^https:\/\/news\.google\.com\/rss\/search\?/);
  } else {
    assert.match(feed.url, /^https:\/\/feeds\.bbci\.co\.uk\/news\/(world|politics)\/rss\.xml$/);
  }
}

const phaseQuery = new URL(feeds[0]!.url).searchParams.get('q') ?? '';
assert.match(phaseQuery, /New Zealand/);
assert.match(phaseQuery, /Recession/);
assert.match(phaseQuery, /when:14d/);

const withoutPhase = planPhaseNewsFeeds(null).map((feed) => feed.id);
assert.equal(withoutPhase.includes('phase'), false);
assert.equal(withoutPhase.includes('rates'), true);

assert.doesNotMatch(PHASE_NEWS_NOTE, /\b(buy|sell|hold)\b/i);
assert.doesNotMatch(PHASE_NEWS_NOTE, /move your money/i);

const described = parseRssFeed(`<?xml version="1.0"?><rss><channel><item>
<title>RBNZ leaves the OCR unchanged - Reuters</title>
<link>https://news.google.com/rss/articles/fixture-ocr</link>
<pubDate>Fri, 02 Oct 2026 01:00:00 GMT</pubDate>
<source url="https://www.reuters.com">Reuters</source>
<description>The Reserve Bank left the official cash rate unchanged in a published decision.</description>
</item></channel></rss>`);
assert.equal(described.ok, true);
if (described.ok) {
  assert.equal(described.items[0]?.title, 'RBNZ leaves the OCR unchanged');
  assert.match(described.items[0]?.summary ?? '', /official cash rate/);
}

const titleOnly = parseRssFeed(`<?xml version="1.0"?><rss><channel><item>
<title>OCR held - Reuters</title>
<link>https://news.google.com/rss/articles/fixture-repeat</link>
<pubDate>Fri, 02 Oct 2026 01:00:00 GMT</pubDate>
<source url="https://www.reuters.com">Reuters</source>
<description>OCR held &amp;nbsp;&amp;nbsp; Reuters</description>
</item></channel></rss>`);
assert.equal(titleOnly.ok, true);
if (titleOnly.ok) assert.equal(titleOnly.items[0]?.summary, null);

const failed = await loadPhaseNews('slowdown', {
  fetchImpl: async () => new Response('<html>down</html>', { status: 502 }),
});
assert.equal(failed.phaseLabel, 'Slowdown');
assert.ok(failed.groups.every((group) => group.status === 'error' && group.items.length === 0));
assert.match(failed.groups[0]?.message ?? '', /HTTP 502/);

const mixed = await loadPhaseNews('expansion', {
  fetchImpl: async (input) => {
    const url = String(input);
    if (url.includes('bbci.co.uk')) {
      return new Response('not a feed', { status: 200 });
    }
    return new Response(
      `<?xml version="1.0"?><rss><channel><item>
<title>GDP growth was published at 0.2 percent - Stats NZ</title>
<link>https://news.google.com/rss/articles/fixture-gdp</link>
<pubDate>Thu, 17 Sep 2026 22:00:00 GMT</pubDate>
<source url="https://www.stats.govt.nz">Stats NZ</source>
<description>Stats NZ published the quarterly gross domestic product figure.</description>
</item></channel></rss>`,
      { status: 200, headers: { 'content-type': 'application/xml' } },
    );
  },
});
const gdp = mixed.groups.find((group) => group.id === 'gdp');
assert.equal(gdp?.status, 'ok');
assert.equal(gdp?.items.length, 1);
assert.equal(gdp?.items[0]?.headline, 'GDP growth was published at 0.2 percent');
assert.equal(gdp?.items[0]?.publication, 'Stats NZ');
assert.equal(gdp?.items[0]?.publishedAt, '2026-09-17T22:00:00.000Z');
assert.match(gdp?.items[0]?.summary ?? '', /gross domestic product/);
assert.equal(gdp?.items[0]?.url, 'https://news.google.com/rss/articles/fixture-gdp');
const world = mixed.groups.find((group) => group.id === 'world');
assert.equal(world?.status, 'error');
assert.deepEqual(world?.items, []);
assert.match(world?.message ?? '', /did not return a feed/);

console.log('phase news tests passed');
