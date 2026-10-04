import { useCallback, useEffect, useState } from 'react';
import { api, formatAuckland } from '../api/client';
import type { NewsFeedResponse, NewsSection, NewsStory } from '../types';

function sectionBlurb(section: NewsSection): string {
  if (section.kind === 'world') {
    return 'World and political headlines from BBC News. This section is not filtered by your holdings.';
  }
  const shown = section.matched.slice(0, 8);
  const extra = section.matchedCount - shown.length;
  const list = shown.join(', ');
  const more = extra > 0 ? ` and ${extra} more` : '';
  if (!list) return 'Included because this asset class is in your holdings.';
  return `Because you hold ${list}${more}.`;
}

function storyMeta(item: NewsStory): string {
  const parts: string[] = [];
  if (item.publisher && item.publisher !== item.sourceName) parts.push(item.publisher);
  if (item.publishedAt) parts.push(formatAuckland(item.publishedAt));
  parts.push(`via ${item.sourceName}`);
  return parts.join(' · ');
}

export function News() {
  const [feed, setFeed] = useState<NewsFeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  const load = useCallback((refresh = false) => {
    setLoading(true);
    return api.news
      .feed(refresh)
      .then((next) => {
        setFeed(next);
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

  const activeFilter =
    filter !== 'all' && feed?.sections.some((section) => section.id === filter) ? filter : 'all';

  if (!feed && loading) {
    return <div className="panel">Loading headlines…</div>;
  }

  if (!feed && error) {
    return (
      <section className="panel warn">
        <h2>News</h2>
        <p>{error}</p>
        <p className="muted">No headlines are shown until a feed responds.</p>
        <button type="button" className="btn" onClick={() => void load(true)}>
          Try again
        </button>
      </section>
    );
  }

  if (!feed) return <div className="panel">Loading headlines…</div>;

  const holdingsSections = feed.sections.filter((section) => section.kind === 'holdings');
  const visible =
    activeFilter === 'all'
      ? feed.sections
      : feed.sections.filter((section) => section.id === activeFilter);

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <h2>News</h2>
          <button type="button" className="btn" onClick={() => void load(true)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <p className="page-lead">
          Headlines for the asset classes you hold, plus world and political news. Stories come from
          Google News and BBC News. A feed that fails stays empty.
        </p>
        {holdingsSections.length === 0 ? (
          <p className="muted small">
            You have no holdings yet, so asset sections are hidden. World and political news is
            still shown.
          </p>
        ) : null}
        {error ? (
          <p className="news-status" role="alert">
            {error} Showing the last feed that loaded.
          </p>
        ) : null}
        <div className="news-filters" role="toolbar" aria-label="Filter news sections">
          <button
            type="button"
            className={activeFilter === 'all' ? 'news-filter-chip active' : 'news-filter-chip'}
            aria-pressed={activeFilter === 'all'}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          {feed.sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={activeFilter === section.id ? 'news-filter-chip active' : 'news-filter-chip'}
              aria-pressed={activeFilter === section.id}
              onClick={() => setFilter(section.id)}
            >
              {section.title}
            </button>
          ))}
        </div>
      </section>

      {visible.map((section) => (
        <section className="panel" key={section.id} aria-labelledby={`news-${section.id}`}>
          <h3 id={`news-${section.id}`}>{section.title}</h3>
          <p className="section-desc">{sectionBlurb(section)}</p>
          <p className="muted small">Source: {section.sources.join(', ')}</p>
          {section.message ? (
            <p
              className={section.status === 'error' ? 'news-status' : 'muted'}
              role={section.status === 'error' ? 'alert' : undefined}
            >
              {section.message}
            </p>
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
                  {item.topic ? <p className="eyebrow">{item.topic}</p> : null}
                  <h3>{item.title}</h3>
                  <p className="muted small">{storyMeta(item)}</p>
                </a>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
