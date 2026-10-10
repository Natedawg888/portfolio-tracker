import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatAuckland } from '../../api/client';
import { flattenNews, filterNews, newsTopics, relatedReading, usefulSummary } from '../../lib/economyView';
import { beginPageRead, commitPageRead, readPageCache } from '../../lib/pageDataCache';
import type { EconomicIndicatorCard, PhaseNewsResponse } from '../../types/economy';

const PAGE = 6;

function newsKey(phase: string | null, country: string): string {
  return `news:${country}:${phase ?? 'none'}`;
}

/**
 * One request per country and phase (cached across visits). Topic filters and
 * "show more" work on the loaded list and never fetch.
 */
export function EconomyNews({
  phase,
  country,
  indicators,
}: {
  phase: string | null;
  country: string;
  indicators: EconomicIndicatorCard[];
}) {
  const initial = readPageCache<PhaseNewsResponse>(newsKey(phase, country));
  const [data, setData] = useState<PhaseNewsResponse | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initial == null);
  const [topic, setTopic] = useState('all');
  const [limit, setLimit] = useState(PAGE);

  const load = useCallback(
    (refresh = false) => {
      const stamp = beginPageRead(newsKey(phase, country));
      return api.economy
        .news({ phase, country, refresh })
        .then((payload) => {
          if (!commitPageRead(stamp, payload)) return;
          setData(payload);
          setError(null);
        })
        .catch((err: Error) => setError(err.message || 'News feeds could not be loaded'))
        .finally(() => setLoading(false));
    },
    [phase, country],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const items = useMemo(() => (data ? flattenNews(data.groups) : []), [data]);
  const topics = useMemo(() => newsTopics(items), [items]);
  const visible = useMemo(() => filterNews(items, topic), [items, topic]);
  const failed = data?.groups.filter((group) => group.status === 'error') ?? [];

  return (
    <section className="panel econ-news" aria-labelledby="econ-news-title">
      <div className="panel-heading">
        <h2 id="econ-news-title">Economic news</h2>
        <button
          type="button"
          className="btn small ghost"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void load(true);
          }}
        >
          {loading ? 'Loading…' : 'Refresh headlines'}
        </button>
      </div>

      {topics.length > 0 ? (
        <div className="econ-chips" role="group" aria-label="Filter headlines by topic">
          {[{ id: 'all', label: `All (${items.length})` }, ...topics].map((option) => (
            <button
              key={option.id}
              type="button"
              className={`econ-chip${topic === option.id ? ' is-on' : ''}`}
              aria-pressed={topic === option.id}
              onClick={() => {
                setTopic(option.id);
                setLimit(PAGE);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="news-status" role="alert">
          {error} No replacement headlines are shown.
        </p>
      ) : null}
      {!data && loading ? (
        <ul className="econ-news-list" aria-busy="true" aria-label="Loading headlines">
          {[0, 1, 2].map((n) => (
            <li key={n} className="econ-news-skeleton" />
          ))}
        </ul>
      ) : null}
      {data && items.length === 0 && !error ? <p className="muted small">The feeds returned no headlines.</p> : null}

      {visible.length > 0 ? (
        <ul className="econ-news-list">
          {visible.slice(0, limit).map((item) => {
            const summary = usefulSummary(item);
            const related = relatedReading(item, indicators);
            return (
              <li key={item.url} className="econ-news-item">
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="econ-news-link">
                  {item.headline}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                <p className="muted tiny">
                  <span className="econ-flag">{item.topicLabel}</span> {item.publication}
                  {item.publishedAt ? ` · ${formatAuckland(item.publishedAt)}` : ''}
                </p>
                {summary ? <p className="small econ-news-summary">{summary}</p> : null}
                {related ? (
                  <p className="tiny econ-news-related">
                    <span className="muted">Related indicator · </span>
                    {related}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {visible.length > limit ? (
        <button type="button" className="btn small ghost econ-more-btn" onClick={() => setLimit((n) => n + PAGE * 2)}>
          Show {Math.min(PAGE * 2, visible.length - limit)} more of {visible.length - limit}
        </button>
      ) : null}

      {failed.length > 0 ? (
        <p className="muted tiny">
          <span aria-hidden="true">⚠ </span>
          {failed.length} feed{failed.length === 1 ? '' : 's'} could not be read: {failed.map((group) => group.title).join(', ')}.
        </p>
      ) : null}
      {data ? (
        <p className="muted tiny">
          {data.note} “Related indicator” shows this page’s reading for the same topic; it is not taken from the article.
        </p>
      ) : null}
    </section>
  );
}
