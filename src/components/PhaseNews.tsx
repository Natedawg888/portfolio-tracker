import { useCallback, useEffect, useState } from 'react';
import { api, formatAuckland } from '../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
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

function newsKey(phase: string | null, country: string): string {
  return `news:${country}:${phase ?? 'none'}`;
}

export function PhaseNews({ phase, country }: { phase: string | null; country: string }) {
  const initialNews = readPageCache<PhaseNewsResponse>(newsKey(phase, country));
  const [data, setData] = useState<PhaseNewsResponse | null>(initialNews ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialNews == null);

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
        .catch((err: Error) => {
          setError(err.message || 'News feeds could not be loaded');
        })
        .finally(() => setLoading(false));
    },
    [phase, country],
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
          ? `Headlines while the calculated phase is ${data.phaseLabel} in ${data.countryName}.`
          : `Headlines for ${data?.countryName ?? 'the selected country'}.`}{' '}
        Central-bank rates, GDP, inflation, unemployment, housing, and the country’s other listed topics.
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
