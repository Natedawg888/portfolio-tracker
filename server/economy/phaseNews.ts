/**
 * Phase-related headlines from the same public RSS feeds as the holdings news page.
 * Google News search for economic topics, plus BBC world and politics.
 * A failed feed is an error with no articles. Headlines are never written here.
 */
import { fetchRss, type FetchRssOptions, type RssItem } from '../news/rss.ts';
import { googleNewsSearchUrl, worldPoliticsFeeds } from '../news/sections.ts';
import { requireEconomyCountry } from './countries.ts';
import type { Phase } from './types.ts';
import { PHASE_LABEL } from './weights.ts';

const PER_FEED = 4;
const GOOGLE_NEWS = 'Google News';

export const PHASE_NEWS_NOTE =
  'Headlines are copied from Google News and BBC News. They are published reporting about the economy. They are not a forecast and they are not instructions.';

export type PhaseNewsItem = {
  headline: string;
  publication: string;
  publishedAt: string | null;
  summary: string | null;
  url: string;
  sourceName: string;
  topic: string;
};

export type PhaseNewsGroup = {
  id: string;
  title: string;
  sourceName: string;
  status: 'ok' | 'empty' | 'error';
  message: string | null;
  items: PhaseNewsItem[];
};

export type PhaseNewsResponse = {
  country: string;
  countryName: string;
  phase: Phase | null;
  phaseLabel: string | null;
  note: string;
  fetchedAt: string;
  groups: PhaseNewsGroup[];
};

type FeedPlan = {
  id: string;
  title: string;
  sourceName: string;
  url: string;
  topic: string;
};

function googleFeed(id: string, title: string, query: string): FeedPlan {
  const q = `${query} when:14d`.replace(/\s+/g, ' ').trim();
  return {
    id,
    title,
    sourceName: GOOGLE_NEWS,
    url: googleNewsSearchUrl(q),
    topic: title,
  };
}

/** Feed list for a calculated phase in one country. The phase only adds a search; it does not write headlines. */
export function planPhaseNewsFeeds(phase: Phase | null, countryCode = 'NZ'): FeedPlan[] {
  const country = requireEconomyCountry(countryCode);
  const feeds: FeedPlan[] = [];
  if (phase) {
    const label = PHASE_LABEL[phase];
    feeds.push(googleFeed('phase', label, `"${country.searchName}" "${label}"`));
  }
  for (const topic of country.topics) {
    feeds.push(googleFeed(topic.id, topic.title, topic.query));
  }
  for (const feed of worldPoliticsFeeds()) {
    const topic = feed.topic ?? 'World';
    feeds.push({
      id: topic === 'Politics' ? 'politics' : 'world',
      title: topic,
      sourceName: feed.sourceName,
      url: feed.url,
      topic,
    });
  }
  return feeds;
}

function byDateDesc(a: RssItem, b: RssItem): number {
  const ta = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
  const tb = b.publishedAt ? Date.parse(b.publishedAt) : NaN;
  const aOk = Number.isFinite(ta);
  const bOk = Number.isFinite(tb);
  if (aOk && bOk) return tb - ta;
  if (aOk) return -1;
  if (bOk) return 1;
  return 0;
}

function toItem(item: RssItem, plan: FeedPlan): PhaseNewsItem {
  return {
    headline: item.title,
    publication: item.publisher || plan.sourceName,
    publishedAt: item.publishedAt,
    summary: item.summary,
    url: item.url,
    sourceName: plan.sourceName,
    topic: plan.topic,
  };
}

function toGroup(plan: FeedPlan, result: Awaited<ReturnType<typeof fetchRss>>): PhaseNewsGroup {
  if (!result.ok) {
    return {
      id: plan.id,
      title: plan.title,
      sourceName: plan.sourceName,
      status: 'error',
      message: `${plan.sourceName}: ${result.error}`,
      items: [],
    };
  }
  const seen = new Set<string>();
  const items: PhaseNewsItem[] = [];
  for (const item of [...result.items].sort(byDateDesc)) {
    const key = `${item.title.trim().toLowerCase()}|${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(toItem(item, plan));
    if (items.length >= PER_FEED) break;
  }
  if (items.length === 0) {
    return {
      id: plan.id,
      title: plan.title,
      sourceName: plan.sourceName,
      status: 'empty',
      message: 'This feed returned no headlines.',
      items: [],
    };
  }
  return {
    id: plan.id,
    title: plan.title,
    sourceName: plan.sourceName,
    status: 'ok',
    message: null,
    items,
  };
}

export async function loadPhaseNews(
  phase: Phase | null,
  opts?: FetchRssOptions,
  countryCode = 'NZ',
): Promise<PhaseNewsResponse> {
  const country = requireEconomyCountry(countryCode);
  const plans = planPhaseNewsFeeds(phase, country.code);
  const fetched = await Promise.all(
    plans.map(async (plan) => ({ plan, result: await fetchRss(plan.url, opts) })),
  );
  return {
    country: country.code,
    countryName: country.name,
    phase,
    phaseLabel: phase ? PHASE_LABEL[phase] : null,
    note: PHASE_NEWS_NOTE,
    fetchedAt: new Date().toISOString(),
    groups: fetched.map(({ plan, result }) => toGroup(plan, result)),
  };
}
