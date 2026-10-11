/**
 * Overview: thin stacked allocation strip, one row per asset class (rows with a
 * tab switch to it; Cash and KiwiSaver link to their pages), and "Needs a look".
 */
import { Link } from 'react-router-dom';
import { formatNzd } from '../../api/client';
import { MONEY_MASK, useMoneyHidden } from '../../lib/privacy';
import { shareOfTotal, type PortfolioIssue, type PortfolioTab } from '../../lib/portfolioView';

export type OverviewRow = {
  key: string;
  name: string;
  value: number;
  colour: string;
  description: string;
  /** Tab to open, or a page to link to. */
  tab?: PortfolioTab;
  href?: string;
};

export function OverviewTab({
  rows,
  issues,
  onOpenTab,
}: {
  rows: OverviewRow[];
  issues: PortfolioIssue[];
  onOpenTab: (tab: PortfolioTab) => void;
}) {
  const hidden = useMoneyHidden();
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  const sorted = [...rows].sort((a, b) => b.value - a.value);

  return (
    <div className="portfolio-overview">
      {issues.length > 0 ? (
        <section className="card needs-look" aria-labelledby="needs-look-title">
          <h3 id="needs-look-title">
            <span aria-hidden="true">⚠ </span>Needs a look
          </h3>
          <ul>
            {issues.map((i) => (
              <li key={i.key}>
                <span>{i.text}</span>
                <button type="button" className="btn small" onClick={() => onOpenTab(i.tab)}>
                  {i.action}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel" aria-labelledby="allocation-title">
        <h3 id="allocation-title">Allocation</h3>
        {total > 0 && !hidden ? (
          <div className="allocation-strip" aria-hidden="true">
            {sorted
              .filter((r) => r.value > 0)
              .map((r) => (
                <span key={r.key} style={{ width: `${(r.value / total) * 100}%`, background: r.colour }} />
              ))}
          </div>
        ) : null}
        <ul className="class-list">
          {sorted.map((r) => {
            const pct = shareOfTotal(r.value, total);
            const body = (
              <>
                <span className="category-dot" style={{ background: r.colour }} aria-hidden="true" />
                <span className="class-list-text">
                  <span className="class-list-name">{r.name}</span>
                  <span className="muted small">{r.description}</span>
                </span>
                <span className="class-list-pct muted small">
                  {pct == null ? '—' : hidden ? `${MONEY_MASK}%` : `${pct.toFixed(pct < 10 ? 1 : 0)}%`}
                </span>
                <span className="class-list-value money">{formatNzd(r.value)}</span>
                <span className="class-list-go" aria-hidden="true">
                  ›
                </span>
              </>
            );
            return (
              <li key={r.key}>
                {r.tab ? (
                  <button type="button" className="class-list-row" onClick={() => onOpenTab(r.tab!)}>
                    {body}
                  </button>
                ) : r.href ? (
                  <Link to={r.href} className="class-list-row">
                    {body}
                  </Link>
                ) : (
                  <div className="class-list-row">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
