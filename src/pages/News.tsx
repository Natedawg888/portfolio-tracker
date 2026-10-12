/**
 * Holdings news. Headlines are the public Google News and BBC feeds.
 * Read, saved, and the two feed settings live on the user (preferences_json.news).
 * Prices and story counts come from holdings and those feeds. Nothing is filled in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { abandonPageRead, beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { usePageCacheValue } from '../lib/usePageCache';
import { showQuietToast } from '../lib/quietToast';
import type { Holding } from '../lib/holdingDisplay';
import {
  applyNewsUserPatch,
  defaultNewsUserState,
  withAllRead,
  withReadUrl,
  withSavedUrl,
  type NewsUserState,
} from '../lib/newsPrefs';
import type { NewsFeedResponse, NewsSection } from '../types';
import {
  annotateStories,
  countUnread,
  groupByDay,
  holdingNewsRows,
  newsSubtitle,
  newsTabs,
  nextNewsTab,
  selectStories,
  storyCountLabel,
  storyMeta,
  type FeedEntry,
  type StoryView,
} from './newsView';

const NEWS_PAGE = 'news-page';
const NEWS_STATE = 'news-state';
const NEWS_HOLDINGS = 'news-holdings';

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-3.5L5 21V4.5a1 1 0 0 1 1-1z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.2-5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function noticesFor(sections: NewsSection[], tab: string, hasStories: boolean): Array<{ text: string; error: boolean }> {
  const relevant = sections.filter((section) => {
    if (tab === 'world' || tab === 'politics') return section.id === 'world';
    if (tab === 'all' || tab === 'saved') return section.status === 'error' || Boolean(section.message && section.status === 'ok');
    return section.id === tab;
  });
  const out: Array<{ text: string; error: boolean }> = [];
  for (const section of relevant) {
    if (section.status === 'error' && section.message) out.push({ text: section.message, error: true });
    else if (section.status === 'ok' && section.message) out.push({ text: section.message, error: false });
    else if (section.status === 'empty' && !hasStories) {
      out.push({ text: section.message || 'No headlines were returned.', error: false });
    }
  }
  return out;
}

export function News() {
  const initial = readPageCache<NewsFeedResponse>(NEWS_PAGE) ?? null;
  const cached = usePageCacheValue<NewsFeedResponse>(NEWS_PAGE);
  const [data, setData] = useState<NewsFeedResponse | null>(initial);
  const shown = data ?? cached ?? null;

  const initialHoldings = readPageCache<Holding[]>(NEWS_HOLDINGS) ?? null;
  const cachedHoldings = usePageCacheValue<Holding[]>(NEWS_HOLDINGS);
  const [holdings, setHoldings] = useState<Holding[] | null>(initialHoldings);
  const shownHoldings = useMemo(() => holdings ?? cachedHoldings ?? [], [holdings, cachedHoldings]);
  const [holdingsError, setHoldingsError] = useState(false);

  const initialState = readPageCache<NewsUserState>(NEWS_STATE) ?? null;
  const cachedState = usePageCacheValue<NewsUserState>(NEWS_STATE);
  const [state, setState] = useState<NewsUserState | null>(initialState);
  const fallbackPrefs = useMemo(() => defaultNewsUserState(), []);
  const prefs = state ?? cachedState ?? fallbackPrefs;
  const settingsReady = (state ?? cachedState) != null;

  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('all');
  const [now, setNow] = useState(() => new Date());
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const stateRef = useRef<NewsUserState | null>(settingsReady ? prefs : null);
  const saveQueue = useRef(Promise.resolve());
  const tabsRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(shown);
  useEffect(() => {
    dataRef.current = shown;
  }, [shown]);
  useEffect(() => {
    stateRef.current = settingsReady ? prefs : null;
  }, [prefs, settingsReady]);

  const load = useCallback((refresh = false, includeClosed?: boolean) => {
    const stamp = beginPageRead(NEWS_PAGE);
    return api.news
      .feed({ refresh, includeClosed })
      .then((payload) => {
        if (!commitPageRead(stamp, payload)) return;
        setData(payload);
        setNow(new Date());
        setError(null);
      })
      .catch((err: Error) => {
        abandonPageRead(stamp);
        if (!refresh && (dataRef.current || readPageCache<NewsFeedResponse>(NEWS_PAGE))) {
          showQuietToast('Could not refresh headlines — showing last data.', { kind: 'warn' });
          return;
        }
        setError(err.message || 'News feeds could not be loaded');
      })
      .finally(() => setRefreshing(false));
  }, []);

  const persist = useCallback((patch: Partial<NewsUserState>) => {
    const run = saveQueue.current.then(async () => {
      if (stateRef.current == null) return null;
      const current = stateRef.current ?? defaultNewsUserState();
      const optimistic = applyNewsUserPatch(current, patch);
      stateRef.current = optimistic;
      setState(optimistic);
      try {
        const saved = await api.news.saveState(optimistic);
        stateRef.current = saved;
        setState(saved);
        const stamp = beginPageRead(NEWS_STATE);
        commitPageRead(stamp, saved);
        return saved;
      } catch {
        showQuietToast('Could not save news settings.', { kind: 'warn' });
        try {
          const fresh = await api.news.state();
          stateRef.current = fresh;
          setState(fresh);
        } catch {
          stateRef.current = current;
          setState(current);
        }
        return null;
      }
    });
    saveQueue.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  useEffect(() => {
    void load(false);
    const stateStamp = beginPageRead(NEWS_STATE);
    void api.news
      .state()
      .then((payload) => {
        if (!commitPageRead(stateStamp, payload)) return;
        setState(payload);
      })
      .catch(() => abandonPageRead(stateStamp));

    const holdStamp = beginPageRead(NEWS_HOLDINGS);
    void api.holdings
      .list()
      .then((rows) => {
        const list = rows as Holding[];
        if (!commitPageRead(holdStamp, list)) return;
        setHoldings(list);
        setHoldingsError(false);
      })
      .catch(() => {
        abandonPageRead(holdStamp);
        if (!readPageCache<Holding[]>(NEWS_HOLDINGS)) setHoldingsError(true);
      });
  }, [load]);

  const stories = useMemo(
    () => annotateStories(shown?.sections ?? [], shownHoldings, prefs.includeClosedPositions),
    [shown, shownHoldings, prefs.includeClosedPositions],
  );
  const tabs = useMemo(
    () => newsTabs(shown?.sections ?? [], shownHoldings, prefs.includeClosedPositions),
    [shown, shownHoldings, prefs.includeClosedPositions],
  );
  const activeTab = tabs.some((item) => item.id === tab) ? tab : 'all';
  const read = useMemo(() => new Set(prefs.readUrls), [prefs.readUrls]);
  const saved = useMemo(() => new Set(prefs.savedUrls), [prefs.savedUrls]);
  const unread = countUnread(stories, read, 'all', saved);
  const visible = useMemo(() => selectStories(stories, activeTab, saved), [stories, activeTab, saved]);
  const groups = useMemo(
    () => groupByDay(visible, now, prefs.groupDailyPriceUpdates),
    [visible, now, prefs.groupDailyPriceUpdates],
  );
  const rows = useMemo(
    () => holdingNewsRows(shownHoldings, stories, prefs.includeClosedPositions),
    [shownHoldings, stories, prefs.includeClosedPositions],
  );
  const notices = shown ? noticesFor(shown.sections, activeTab, visible.length > 0) : [];
  const pending = shown == null && !error;

  const markRead = (url: string) => {
    const current = stateRef.current;
    if (!current || current.readUrls.includes(url)) return;
    void persist({ readUrls: withReadUrl(current, url).readUrls });
  };

  const toggleSaved = (url: string) => {
    const current = stateRef.current;
    if (!current) return;
    void persist({ savedUrls: withSavedUrl(current, url, !current.savedUrls.includes(url)).savedUrls });
  };

  const markAll = () => {
    const current = stateRef.current;
    if (!current) return;
    void persist({ readUrls: withAllRead(current, stories.map((story) => story.story.url)).readUrls });
  };

  const renderStory = (story: StoryView) => {
    const isRead = read.has(story.story.url);
    const isSaved = saved.has(story.story.url);
    return (
      <article key={story.story.url} className="news-row">
        <span className={isRead ? 'news-dot is-read' : 'news-dot'} aria-hidden="true" />
        <a
          className="news-row-link"
          href={story.story.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => markRead(story.story.url)}
        >
          {isRead ? null : <span className="sr-only">Unread. </span>}
          <h3 className="news-headline">{story.story.title}</h3>
          <p className="news-meta">
            <span>{storyMeta(story.story)}</span>
            <span className="news-chip">{story.chip}</span>
          </p>
        </a>
        <button
          type="button"
          className={isSaved ? 'news-save is-saved' : 'news-save'}
          aria-pressed={isSaved}
          disabled={!settingsReady}
          aria-label={isSaved ? `Remove “${story.story.title}” from saved` : `Save “${story.story.title}”`}
          onClick={() => toggleSaved(story.story.url)}
        >
          <BookmarkIcon filled={isSaved} />
        </button>
      </article>
    );
  };

  const renderEntry = (entry: FeedEntry) => {
    if (entry.kind === 'story') return renderStory(entry.story);
    const open = openGroups.has(entry.id);
    return (
      <div key={entry.id} className="news-price-group">
        {renderStory(entry.lead)}
        <button
          type="button"
          className="news-more"
          aria-expanded={open}
          onClick={() =>
            setOpenGroups((prev) => {
              const next = new Set(prev);
              if (next.has(entry.id)) next.delete(entry.id);
              else next.add(entry.id);
              return next;
            })
          }
        >
          {open
            ? 'Hide price updates'
            : `${entry.more.length} more price update${entry.more.length === 1 ? '' : 's'}`}
        </button>
        {open ? entry.more.map((story) => renderStory(story)) : null}
      </div>
    );
  };

  return (
    <div className="stack news-page">
      <header className="news-header">
        <div>
          <h2 className="page-title">News</h2>
          <p className="muted small news-tagline">
            {shown ? newsSubtitle(unread, shown.fetchedAt) : error ? 'Headlines unavailable · Google News & BBC' : 'Loading headlines · Google News & BBC'}
          </p>
        </div>
        <div className="news-header-actions">
          <button type="button" className="btn news-mark" disabled={!settingsReady || unread === 0 || stories.length === 0} onClick={markAll}>
            Mark all read
          </button>
          <button
            type="button"
            className="btn primary news-refresh"
            disabled={refreshing || pending}
            aria-busy={refreshing || pending}
            onClick={() => {
              setRefreshing(true);
              void load(true, settingsReady ? prefs.includeClosedPositions : undefined);
            }}
          >
            <RefreshIcon />
            {refreshing || pending ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <div
        ref={tabsRef}
        className="news-tabs"
        role="tablist"
        aria-label="News sections"
        onKeyDown={(event) => {
          const next = nextNewsTab(
            tabs.map((item) => item.id),
            activeTab,
            event.key,
          );
          if (!next) return;
          event.preventDefault();
          setTab(next);
          tabsRef.current?.querySelector<HTMLButtonElement>(`#news-tab-${next}`)?.focus();
        }}
      >
        {tabs.map((item) => {
          const count = shown ? countUnread(stories, read, item.id, saved) : 0;
          const selected = item.id === activeTab;
          return (
            <button
              key={item.id}
              id={`news-tab-${item.id}`}
              type="button"
              role="tab"
              className={selected ? 'news-tab active' : 'news-tab'}
              aria-selected={selected}
              aria-controls="news-feed"
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {count > 0 ? <span className="news-tab-count">{count}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="news-layout">
        <section className="panel news-feed" id="news-feed" role="tabpanel" aria-labelledby={`news-tab-${activeTab}`} aria-busy={pending || refreshing}>
          {error ? (
            <p className="news-status" role="alert">
              {error} No replacement headlines are shown.
            </p>
          ) : null}
          {pending ? <p className="muted">Loading headlines from Google News and BBC News.</p> : null}
          {notices.map((notice) => (
            <p key={notice.text} className={notice.error ? 'news-status' : 'muted small'} role={notice.error ? 'alert' : undefined}>
              {notice.text}
            </p>
          ))}
          {shown && visible.length === 0 && !pending ? (
            <p className="muted">
              {activeTab === 'saved' ? 'No saved headlines in this feed.' : 'No headlines in this tab.'}
            </p>
          ) : null}
          {groups.map((group) => (
            <div key={group.key} className="news-day-block">
              <h3 className="news-day">{group.heading}</h3>
              {group.entries.map((entry) => renderEntry(entry))}
            </div>
          ))}
        </section>

        <aside className="news-rail">
          <section className="panel" aria-labelledby="news-by-holding">
            <h3 id="news-by-holding">By holding</h3>
            {holdingsError && rows.length === 0 ? <p className="muted small">Holdings could not be loaded.</p> : null}
            {!holdingsError && rows.length === 0 ? (
              <p className="muted small">
                {prefs.includeClosedPositions ? 'No holdings yet.' : 'No open holdings.'}
              </p>
            ) : null}
            <ul className="news-holdings">
              {rows.map((row) => (
                <li key={row.key} className="news-holding">
                  <div>
                    <strong>{row.ticker}</strong>
                    <span className="muted">{row.detail}</span>
                  </div>
                  <span className="news-holding-count">{storyCountLabel(row.stories)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel" aria-labelledby="news-settings">
            <h3 id="news-settings">Feed settings</h3>
            <label className="news-check" htmlFor="news-group-prices">
              <span>Group daily price updates</span>
              <input
                id="news-group-prices"
                type="checkbox"
                checked={prefs.groupDailyPriceUpdates}
                disabled={!settingsReady}
                onChange={(event) => void persist({ groupDailyPriceUpdates: event.target.checked })}
              />
            </label>
            <label className="news-check" htmlFor="news-include-closed">
              <span>Include closed positions</span>
              <input
                id="news-include-closed"
                type="checkbox"
                checked={prefs.includeClosedPositions}
                disabled={!settingsReady}
                onChange={(event) => {
                  const value = event.target.checked;
                  void (async () => {
                    const savedState = await persist({ includeClosedPositions: value });
                    if (!savedState) return;
                    setRefreshing(true);
                    await load(true, savedState.includeClosedPositions);
                  })();
                }}
              />
            </label>
            <p className="news-footnote">Headlines come straight from the feeds. Nothing is written or summarised by the app.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
