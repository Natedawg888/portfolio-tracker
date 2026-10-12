/**
 * The year's latest snapshot, one expandable row per class. Holdings now held at
 * 0 shares but still valued at cost get a badge and a warning above the list.
 */
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatAuckland, formatNzd } from '../../api/client';
import {
  costValuedBadge,
  costValuedWarning,
  holdingsByClass,
  type CostValuedSold,
  type SnapshotHolding,
} from '../../lib/historyView';

export function HistoryLatest({
  takenAt,
  holdings,
  classColour,
  flags,
}: {
  takenAt: string;
  holdings: SnapshotHolding[];
  classColour: (classKey: string) => string | undefined;
  /** The latest snapshot's cost-valued sold holdings. */
  flags: CostValuedSold[];
}) {
  const baseId = useId();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const groups = holdingsByClass(holdings);
  const flagById = new Map(flags.map((f) => [f.holdingId, f]));

  function toggle(classKey: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(classKey)) next.add(classKey);
      return next;
    });
  }

  return (
    <section className="panel history-latest" aria-labelledby={`${baseId}-heading`}>
      <h3 id={`${baseId}-heading`}>In the latest snapshot · {formatAuckland(takenAt)}</h3>
      {groups.length === 0 ? (
        <p className="muted history-latest-empty">This snapshot didn’t record holdings. New snapshots do.</p>
      ) : (
        <>
          {flags.length > 0 ? (
            <div className="debt-warning history-latest-warning" role="note">
              <p>
                <span aria-hidden="true">⚠ </span>
                {costValuedWarning(flags, formatNzd)}
              </p>
              <Link to="/portfolio" className="history-latest-review">
                Review in Portfolio <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : null}
          <ul className="category-budget-list">
            {groups.map((g) => {
              const isOpen = open.has(g.classKey);
              const listId = `${baseId}-${g.classKey}`;
              return (
                <li key={g.classKey} className="category-budget-row">
                  <button
                    type="button"
                    className="category-budget-hit"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? listId : undefined}
                    onClick={() => toggle(g.classKey)}
                  >
                    <span className="category-budget-top">
                      <span className="category-budget-name">
                        <span
                          className="category-dot"
                          style={{ background: classColour(g.classKey) ?? 'var(--muted)' }}
                          aria-hidden="true"
                        />
                        {g.label}
                        <span className="muted small history-latest-count">
                          {g.holdings.length} holding{g.holdings.length === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className={'money' + (g.totalNzd < 0 ? ' return-neg' : '')}>
                        {formatNzd(g.totalNzd)}
                        <span aria-hidden="true" className="muted history-latest-chevron">
                          {isOpen ? ' ▴' : ' ▾'}
                        </span>
                      </span>
                    </span>
                  </button>
                  {isOpen ? (
                    <ul id={listId} className="history-latest-holdings">
                      {g.holdings.map((h) => {
                        const flag = flagById.get(h.id);
                        return (
                          <li key={h.id}>
                            <span className="history-latest-holding">
                              {h.label || h.id}
                              {flag ? <span className="txn-direction-flag">{costValuedBadge(flag)}</span> : null}
                            </span>
                            <span className={'money' + (h.valueNzd < 0 ? ' return-neg' : '')}>
                              {formatNzd(h.valueNzd)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
