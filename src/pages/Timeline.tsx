/**
 * Financial timeline (KAN-62): bank transactions, crypto (wallet history and the ledger), dividends
 * and net-worth milestones in one list, newest first, filterable by type and date. Opened from
 * History. Figures come from GET /api/timeline (server/timeline/store.ts). Amounts follow Hide amounts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import type { TimelineEvent, TimelineType } from '../types';
import { useMoneyHidden } from '../lib/privacy';
import { longDate } from './warrantiesView';
import { TIMELINE_TYPE_LABEL, groupByDay, timelineRange, type TimelineRange } from '../lib/timelineView';

const TYPES: TimelineType[] = ['bank', 'crypto', 'dividend', 'milestone'];

export function Timeline() {
  useMoneyHidden();
  const [types, setTypes] = useState<TimelineType[]>(TYPES);
  const [range, setRange] = useState<TimelineRange>('90d');
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setEvents(null);
    const { from, to } = timelineRange(range, new Date());
    api.timeline
      .list({ from, to, types })
      .then(setEvents)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the timeline.'));
  }, [types, range]);
  useEffect(load, [load]);

  const days = useMemo(() => (events ? groupByDay(events) : []), [events]);
  const toggle = (t: TimelineType) => setTypes((prev) => (prev.includes(t) ? (prev.length > 1 ? prev.filter((x) => x !== t) : prev) : [...prev, t]));

  return (
    <div className="stack bills-page timeline-page">
      <header className="warranties-header">
        <div>
          <Link className="warranties-back" to="/yearly">
            ‹ History
          </Link>
          <h2 className="page-title">Timeline</h2>
          <p className="muted small">Your money events in order: spending and income, crypto, dividends and net-worth milestones.</p>
        </div>
      </header>

      <section className="panel timeline-filters" aria-label="Filters">
        <div className="row gap" role="group" aria-label="What to show">
          {TYPES.map((t) => (
            <button key={t} type="button" className={`btn small${types.includes(t) ? ' primary' : ' ghost'}`} aria-pressed={types.includes(t)} onClick={() => toggle(t)}>
              {TIMELINE_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <label className="small">
          Period{' '}
          <select value={range} onChange={(e) => setRange(e.target.value as TimelineRange)}>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="1y">Last 12 months</option>
            <option value="all">Everything</option>
          </select>
        </label>
      </section>

      {error ? (
        <div className="panel">
          <p className="auth-error" role="alert">{error}</p>
          <button type="button" className="btn small" onClick={load}>
            Try again
          </button>
        </div>
      ) : null}
      {!events && !error ? <p className="muted">Loading the timeline…</p> : null}
      {events && !events.length ? (
        <section className="panel">
          <h3>Nothing in this period</h3>
          <p className="muted small">Try a longer period or more types. Transactions from your bank, wallets and dividends appear here as they come in.</p>
        </section>
      ) : null}

      {days.map((d) => (
        <section key={d.date} className="panel timeline-day" aria-label={longDate(d.date)}>
          <h3 className="timeline-date">{longDate(d.date)}</h3>
          <ul className="timeline-list">
            {d.events.map((e) => (
              <li key={e.id} className={`timeline-item timeline-item--${e.type}`}>
                <span className="timeline-type">{TIMELINE_TYPE_LABEL[e.type]}</span>
                <span className="timeline-main">
                  {e.link ? <Link to={e.link}>{e.title}</Link> : e.title}
                  {e.detail ? <span className="muted small"> · {e.detail}</span> : null}
                </span>
                <span className={`timeline-amount money${e.direction === 'out' ? ' timeline-out' : e.direction === 'in' ? ' timeline-in' : ''}`}>
                  {e.amountNzd != null ? formatNzd(e.amountNzd) : e.amountText ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
