/**
 * Load planned sections from public feeds.
 * Failed feeds stay empty with an error message. Stories are never invented.
 */
import type { NewsSection, NewsStory } from '../../src/types/index.ts';
import { fetchRss, type FetchRssOptions } from './rss.ts';
import type { NewsSectionPlan } from './sections.ts';

const HOLDINGS_LIMIT = 8;
const WORLD_PER_TOPIC = 5;

function byDateDesc(a: NewsStory, b: NewsStory): number {
  const ta = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
  const tb = b.publishedAt ? Date.parse(b.publishedAt) : NaN;
  const aOk = Number.isFinite(ta);
  const bOk = Number.isFinite(tb);
  if (aOk && bOk) return tb - ta;
  if (aOk) return -1;
  if (bOk) return 1;
  return 0;
}

function dedupeStories(items: NewsStory[]): NewsStory[] {
  const out: NewsStory[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.title.trim().toLowerCase()}|${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function interleaveTopics(items: NewsStory[], perTopic: number): NewsStory[] {
  const buckets = new Map<string, NewsStory[]>();
  for (const item of items) {
    const key = item.topic || 'Other';
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  for (const list of buckets.values()) list.sort(byDateDesc);
  const out: NewsStory[] = [];
  const keys = [...buckets.keys()];
  for (let i = 0; i < perTopic; i++) {
    for (const key of keys) {
      const item = buckets.get(key)?.[i];
      if (item) out.push(item);
    }
  }
  return out;
}

function selectStories(plan: NewsSectionPlan, items: NewsStory[]): NewsStory[] {
  const unique = dedupeStories(items);
  if (plan.kind === 'world') return interleaveTopics(unique, WORLD_PER_TOPIC);
  return unique.sort(byDateDesc).slice(0, HOLDINGS_LIMIT);
}

export async function loadNewsSections(
  plans: NewsSectionPlan[],
  opts?: FetchRssOptions,
): Promise<NewsSection[]> {
  return Promise.all(plans.map((plan) => loadSection(plan, opts)));
}

async function loadSection(plan: NewsSectionPlan, opts?: FetchRssOptions): Promise<NewsSection> {
  const sources = [...new Set(plan.feeds.map((feed) => feed.sourceName))];
  const fetched = await Promise.all(
    plan.feeds.map(async (feed) => ({
      feed,
      result: await fetchRss(feed.url, opts),
    })),
  );

  const items: NewsStory[] = [];
  const errors: string[] = [];
  for (const { feed, result } of fetched) {
    if (!result.ok) {
      const label = feed.topic ? `${feed.sourceName} (${feed.topic})` : feed.sourceName;
      errors.push(`${label}: ${result.error}`);
      continue;
    }
    for (const item of result.items) {
      items.push({
        title: item.title,
        url: item.url,
        publisher: item.publisher,
        publishedAt: item.publishedAt,
        sourceName: feed.sourceName,
        topic: feed.topic ?? null,
      });
    }
  }

  const selected = selectStories(plan, items);
  let status: NewsSection['status'];
  let message: string | null;
  if (selected.length === 0 && errors.length > 0) {
    status = 'error';
    message = errors.join(' ');
  } else if (selected.length === 0) {
    status = 'empty';
    message =
      plan.kind === 'world'
        ? 'No world or political headlines were returned.'
        : 'No headlines were returned for these holdings.';
  } else {
    status = 'ok';
    message = errors.length > 0 ? `Some feeds failed. ${errors.join(' ')}` : null;
  }

  return {
    id: plan.id,
    title: plan.title,
    kind: plan.kind,
    matched: plan.matched,
    matchedCount: plan.matchedCount,
    status,
    message,
    sources,
    items: status === 'error' ? [] : selected,
  };
}
