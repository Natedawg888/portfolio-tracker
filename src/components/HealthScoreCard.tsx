/**
 * Financial health score card on the Dashboard (KAN-55).
 * Score, band and a one-line summary, with the five checks behind it on demand.
 * Cached under dashboard:health, so budget / debt / KiwiSaver edits refresh it.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { usePageCacheValue } from '../lib/usePageCache';
import { HEALTH_BAND_LABELS, type HealthCheck } from '../lib/healthScore';
import { useMoneyHidden } from '../lib/privacy';
import type { HealthScoreResponse } from '../types';

const KEY = 'dashboard:health';

function valueText(c: HealthCheck): string {
  if (c.value == null) return '—';
  if (c.unit === 'months') return `${Math.round(c.value * 10) / 10} mo`;
  return `${Math.round(c.value * 1000) / 10}%`;
}

export function HealthScoreCard() {
  const cached = usePageCacheValue<HealthScoreResponse>(KEY);
  const [state, setState] = useState<HealthScoreResponse | null>(() => readPageCache<HealthScoreResponse>(KEY) ?? null);
  const data = state ?? cached ?? null;
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const moneyHidden = useMoneyHidden();
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    const stamp = beginPageRead(KEY);
    api.healthScore
      .get()
      .then((r) => {
        if (cancelled || !commitPageRead(stamp, r)) return;
        setState(r);
        setError(null);
      })
      .catch(() => {
        if (!cancelled && !dataRef.current) setError('Your health score could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="card health-score" aria-labelledby="health-score-heading">
      <div className="health-score-head">
        <h2 id="health-score-heading" className="month-snapshot-period">Financial health</h2>
        {data?.score != null ? (
          <span className={`health-score-band health-score-band--${data.band}`}>{HEALTH_BAND_LABELS[data.band!]}</span>
        ) : null}
      </div>
      {error ? (
        <p className="month-snapshot-error" role="alert">{error}</p>
      ) : !data ? (
        <p className="month-snapshot-status">Working out your score…</p>
      ) : (
        <>
          <div className="health-score-main">
            {data.score != null ? (
              <p className="health-score-value" aria-label={`Score ${data.score} out of 100`}>
                {moneyHidden ? '••' : data.score}
                <span className="health-score-out-of">/100</span>
              </p>
            ) : null}
            <p className="health-score-summary">{data.summary}</p>
          </div>
          {data.score != null ? (
            <div className="health-score-bar" aria-hidden="true">
              <span style={{ width: `${moneyHidden ? 0 : data.score}%` }} />
            </div>
          ) : null}
          <button type="button" className="btn small ghost health-score-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide how it’s worked out' : 'How it’s worked out'}
          </button>
          {open ? (
            <ul className="health-score-checks">
              {data.checks.map((c) => (
                <li key={c.key}>
                  <div className="health-score-check-head">
                    <strong>{c.label}</strong>
                    <span className="muted small">
                      {c.score == null ? 'Not enough data' : `${moneyHidden ? '••' : c.score}/100 · ${moneyHidden ? '••' : valueText(c)}`} · weight {c.weight}%
                    </span>
                  </div>
                  <div className="muted small">{moneyHidden ? 'Hidden while amounts are hidden.' : c.explanation}</div>
                  {c.tip && !moneyHidden ? <div className="small">{c.tip}</div> : null}
                </li>
              ))}
              <li className="muted small">
                Based on the last {data.windowMonths} complete months of your Budget, your bank balances and Debts. Checks without
                enough data are left out. Educational only — not financial advice.
              </li>
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
