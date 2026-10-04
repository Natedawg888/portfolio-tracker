import { useCallback, useEffect, useState } from 'react';
import { api, formatAuckland } from '../api/client';
import type { PhaseNewsGroup, PhaseNewsItem, PhaseNewsResponse } from '../types/economy';

function itemMeta(item: PhaseNewsItem): string {
  const parts = [item.publication];
  if (item.publishedAt) parts.push(formatAuckland(item.publishedAt));
  if (item.sourceName && item.sourceName !== item.publication) parts.push(`via ${item.sourceName}`);
  return parts.join(' · ');
}

function groupIntro(group: PhaseNewsGroup): string {
  if (group.id === 'world' || group.id === 'politics') {
    return 'BBC News, as published. The headline and summary are the feed’s own wording.';
  }
  return 'Google News search results. Each headline and summary is taken from the feed.';
}

export function PhaseNews({ phase }: { phase: string | null }) {
  const [data, setData] = useState<PhaseNewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    (refresh = false) => {
      return api.economy
        .news({ phase, refresh })
        .then((payload) => {
          setData(payload);
          setError(null);
        })
        .catch((err: Error) => {
          setError(err.message || 'News feeds could not be loaded');
        })
        .finally(() => setLoading(false));
    },
    [phase],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <section className="panel" aria-label="Related news">
      <div className="panel-heading">
        <h2>Related news</h2>
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
      <p className="section-desc">
        {data?.phaseLabel
          ? `Headlines while the calculated phase is ${data.phaseLabel}.`
          : 'Headlines for the same topics used to read the phase.'}{' '}
        Central-bank rates, GDP, inflation, unemployment, housing, and global developments.
      </p>
      {data ? <p className="muted small">{data.note}</p> : null}
      {error ? (
        <p className="news-status" role="alert">
          {error} No replacement headlines are shown.
        </p>
      ) : null}
      {!data && loading ? <p className="muted">Loading headlines from Google News and BBC News.</p> : null}
      {data?.groups.map((group) => (
        <div key={group.id} className="phase-news-group">
          <h3>{group.title}</h3>
          <p className="muted small">{groupIntro(group)}</p>
          {group.message ? (
            <p className={group.status === 'error' ? 'news-status' : 'muted small'} role={group.status === 'error' ? 'alert' : undefined}>
              {group.message}
            </p>
          ) : null}
          {group.items.length > 0 ? (
            <div className="news-grid">
              {group.items.map((item) => (
                <a key={item.url} className="card news-card" href={item.url} target="_blank" rel="noopener noreferrer">
                  <h3>{item.headline}</h3>
                  <p className="muted small">{itemMeta(item)}</p>
                  <p className="muted small">{item.summary ?? 'No summary in this feed item.'}</p>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}
