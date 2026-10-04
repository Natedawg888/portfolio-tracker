/**
 * Public RSS fetch + parse for the news page.
 * Items are taken only from the feed body. A failed or non-feed response
 * returns an error and zero stories — never a placeholder headline.
 */

export type RssItem = {
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: string | null;
  /** Description text from the feed, or null when the item has none. */
  summary: string | null;
};

export type RssFetchResult =
  | { ok: true; items: RssItem[] }
  | { ok: false; error: string };

const UA = 'PortfolioTracker/0.1 (personal headlines reader)';
const FETCH_MS = 12_000;
const MAX_CHARS = 1_500_000;
const CACHE_MS = 10 * 60 * 1000;
const MAX_ITEMS = 30;

type CacheEntry = { at: number; result: RssFetchResult };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<RssFetchResult>>();

export type FetchRssOptions = {
  /** Skip the in-memory cache and store a fresh success. */
  refresh?: boolean;
  fetchImpl?: typeof fetch;
};

function decodeXml(raw: string): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ');
  s = s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (all, n) => {
      const cp = Number(n);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : all;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (all, n) => {
      const cp = parseInt(n, 16);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : all;
    });
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tagInner(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseRssDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim());
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function summaryFromFeed(raw: string, title: string): string | null {
  const text = raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const titleNorm = title.toLowerCase();
  const textNorm = text.toLowerCase();
  if (textNorm === titleNorm) return null;
  if (textNorm.startsWith(titleNorm)) {
    const rest = text.slice(title.length).replace(/^[\s\-–—|:]+/, '').trim();
    if (rest.length < 40) return null;
  }
  if (text.length <= 280) return text;
  return `${text.slice(0, 277).trimEnd()}…`;
}

function stripTrailingPublisher(title: string, publisher: string | null): string {
  if (!publisher) return title;
  const suffix = ` - ${publisher}`;
  if (title.endsWith(suffix)) {
    const next = title.slice(0, -suffix.length).trim();
    if (next) return next;
  }
  return title;
}

/** Parse an RSS 2.0 document. Non-feeds are an error, not an empty success. */
export function parseRssFeed(xml: string): RssFetchResult {
  if (!xml || !/<(rss|feed)\b/i.test(xml)) {
    return { ok: false, error: 'News source did not return a feed' };
  }
  const items: RssItem[] = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && items.length < MAX_ITEMS) {
    const block = m[1] ?? '';
    const titleRaw = decodeXml(tagInner(block, 'title') ?? '');
    const link = decodeXml(tagInner(block, 'link') ?? '');
    if (!titleRaw || !isHttpUrl(link)) continue;
    const publisherRaw = decodeXml(tagInner(block, 'source') ?? '');
    const publisher = publisherRaw || null;
    const title = stripTrailingPublisher(titleRaw, publisher);
    items.push({
      title,
      url: link,
      publisher,
      publishedAt: parseRssDate(tagInner(block, 'pubDate')),
      summary: summaryFromFeed(decodeXml(tagInner(block, 'description') ?? ''), title),
    });
  }
  return { ok: true, items };
}

function shortError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').slice(0, 180) || 'Feed request failed';
}

async function fetchRssUncached(url: string, fetchImpl: typeof fetch): Promise<RssFetchResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': UA,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_MS),
    });
  } catch (err) {
    return { ok: false, error: shortError(err) };
  }
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    return { ok: false, error: shortError(err) };
  }
  if (text.length > MAX_CHARS) {
    return { ok: false, error: 'Feed response was too large' };
  }
  return parseRssFeed(text);
}

export async function fetchRss(url: string, opts?: FetchRssOptions): Promise<RssFetchResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  // Custom fetch (tests) and explicit refresh must not reuse another user's in-flight call.
  const bypass = Boolean(opts?.refresh || opts?.fetchImpl);
  if (!bypass) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
    const pending = inflight.get(url);
    if (pending) return pending;
  }

  const promise = fetchRssUncached(url, fetchImpl).then((result) => {
    if (!opts?.fetchImpl && result.ok) {
      cache.set(url, { at: Date.now(), result });
    }
    return result;
  });

  if (!bypass) {
    inflight.set(url, promise);
    promise.finally(() => {
      if (inflight.get(url) === promise) inflight.delete(url);
    });
  }
  return promise;
}

/** Test hook. */
export function clearRssCache(): void {
  cache.clear();
  inflight.clear();
}
