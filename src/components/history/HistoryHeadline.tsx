/**
 * History headline: net worth at the year's latest snapshot and the change
 * since the year's first snapshot. The year's chart renders below it, in the same card.
 */
import type { ReactNode } from 'react';
import { formatAuckland, formatNzd } from '../../api/client';
import type { HeadlineSnapshot, YearHeadline } from '../../lib/historyView';
import { aucklandDate, shortDate } from '../../lib/netWorthHistory';
import { useMoneyHidden } from '../../lib/privacy';

export function HistoryHeadline({
  headline,
  children,
}: {
  headline: YearHeadline<HeadlineSnapshot>;
  children?: ReactNode;
}) {
  const moneyHidden = useMoneyHidden();
  const { latest, first, changeNzd, changePct } = headline;
  const firstDate = aucklandDate(first.takenAt);

  return (
    <section className="hero-card history-headline" aria-labelledby="history-headline-heading">
      <h3 id="history-headline-heading" className="eyebrow">
        Net worth
      </h3>
      <p className={'hero-value' + (latest.totalNzd < 0 ? ' return-neg' : '')}>{formatNzd(latest.totalNzd)}</p>
      <p className="muted small hero-sub">Latest snapshot {formatAuckland(latest.takenAt)}</p>
      {changeNzd == null ? (
        <p className="muted small history-headline-change">Take another snapshot to see the change</p>
      ) : (
        <ChangeLine
          amount={changeNzd}
          // A percentage still reveals how the hidden amounts moved.
          pct={moneyHidden ? null : changePct}
          since={firstDate ? shortDate(firstDate) : formatAuckland(first.takenAt)}
        />
      )}
      {children}
    </section>
  );
}

function ChangeLine({ amount, pct, since }: { amount: number; pct: number | null; since: string }) {
  const dir = amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
  const tone = dir === 'up' ? 'return-pos' : dir === 'down' ? 'return-neg' : 'muted';
  return (
    <p className={`net-worth-delta history-headline-change ${tone}`}>
      <span aria-hidden="true">{arrow} </span>
      <span className="sr-only">{dir === 'up' ? 'Up ' : dir === 'down' ? 'Down ' : 'No change, '}</span>
      {formatNzd(Math.abs(amount))}
      {pct == null ? '' : ` (${dir === 'up' ? '+' : dir === 'down' ? '−' : ''}${Math.abs(pct).toFixed(1)}%)`} since {since}
    </p>
  );
}
