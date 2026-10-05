/**
 * Holdings news page. Sections come from the signed-in user's holdings.
 * World and politics always load. Feeds are public RSS; no API key.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, formatAuckland } from '../api/client';
import type { NewsFeedResponse, NewsSection, NewsStory } from '../types';

function itemMeta(item: NewsStory): string {
  const parts: string[] = [];
  if (item.publisher) parts.push(item.publisher);
  if (item.publishedAt) parts.push(formatAuckland(item.publishedAt));
  if (item.topic) parts.push(item.topic);
  if (item.sourceName && item.sourceName !== item.publisher) parts.push(`via ${item.sourceName}`);
  return parts.join(' · ') || item.sourceName;
}

function sectionIntro(section: NewsSection): string {
  if (section.kind === 'world') {
    return 'BBC News world and politics, as published. The headline is the feed’s own wording.';
  }
  return 'Google News search results for these holdings. Each headline is taken from the feed.';
}

function matchedLine(section: NewsSection): string | null {
  if (section.kind !== 'holdings' || section.matched.length === 0) return null;
  const extra = section.matchedCount - section.matched.length;
  const list = section.matched.join(', ');
  if (extra > 0) return `Opened for ${list}, and ${extra} more.`;
  return `Opened for ${list}.`;
}

export function News() {
  const [data, setData] = useState<NewsFeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((refresh = false) => {
    return api.news
      .feed({ refresh })
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err: Error) => {
        setError(err.message || 'News feeds could not be loaded');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const hasHoldingSections = data?.sections.some((section) => section.kind === 'holdings') ?? false;

  return (
    <div className="stack">
      <div>
        <h2 className="page-title">News</h2>
        <p className="page-lead">
          Headlines for the holdings on this account, plus world and politics.
          Google News and BBC News are public feeds, so no news API key is required.
          A missing or failed feed stays empty. Nothing is filled in.
        </p>
      </div>

      <section className="panel" aria-label="Portfolio news">
        <div className="panel-heading">
          <h2>Holdings news</h2>
          <button
            type="button"
            className="btn small"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void load(true);
            }}
          >
            {loading ? 'Loading headlines…' : 'Refresh headlines'}
          </button>
        </div>
        {data ? <p className="muted small">Updated {formatAuckland(data.fetchedAt)}.</p> : null}
        {error ? (
          <p className="news-status" role="alert">
            {error} No replacement headlines are shown.
          </p>
        ) : null}
        {!data && loading ? (
          <p className="muted">Loading headlines from Google News and BBC News.</p>
        ) : null}
        {data && !hasHoldingSections ? (
          <p className="muted">
            No holding-specific sections yet. Add holdings on Portfolio and they will open a section here.
            World and politics still load.
          </p>
        ) : null}
        {data?.sections.map((section) => {
          const matched = matchedLine(section);
          return (
            <div key={section.id} className="phase-news-group">
              <h3>{section.title}</h3>
              <p className="muted small">{sectionIntro(section)}</p>
              {matched ? <p className="muted small">{matched}</p> : null}
              {section.message ? (
                <p
                  className={section.status === 'error' ? 'news-status' : 'muted small'}
                  role={section.status === 'error' ? 'alert' : undefined}
                >
                  {section.message}
                </p>
              ) : null}
              {section.status === 'empty' && !section.message ? (
                <p className="muted small">No headlines were returned.</p>
              ) : null}
              {section.items.length > 0 ? (
                <div className="news-grid">
                  {section.items.map((item) => (
                    <a
                      key={`${section.id}:${item.url}`}
                      className="card news-card"
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <h3>{item.title}</h3>
                      <p className="muted small">{itemMeta(item)}</p>
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </section>
    </div>
  );
}
