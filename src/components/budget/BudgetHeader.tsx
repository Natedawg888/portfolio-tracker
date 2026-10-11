/**
 * Budget page header: ‹ Month Year › switcher (Prev stops at the import floor),
 * a "Day X of Y" caption, Bills / Warranties links and one "+ Add" menu.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { prefetchNavTarget } from '../../lib/routePrefetch';
import type { MonthProgress } from '../../lib/budgetView';

export type AddAction = { key: string; label: string; onSelect: () => void };

function progressCaption(p: MonthProgress): string {
  if (p.state === 'current') return `Day ${p.day} of ${p.daysInMonth}`;
  if (p.state === 'past') return `Month complete · ${p.daysInMonth} days`;
  return 'Not started yet';
}

export function BudgetHeader({
  monthLong,
  progress,
  canGoPrev,
  onPrev,
  onNext,
  addActions,
}: {
  monthLong: string;
  progress: MonthProgress;
  canGoPrev: boolean;
  onPrev: () => void;
  onNext: () => void;
  addActions: AddAction[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('.budget-add-options button')?.focus();
    const onDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="budget-header">
      <div className="budget-header-month">
        <h2 className="page-title budget-header-title">Budget</h2>
        <nav className="budget-month-switch" aria-label="Budget month">
          <button
            type="button"
            className="budget-month-step"
            disabled={!canGoPrev}
            aria-label="Previous month"
            title={canGoPrev ? 'Previous month' : 'Budget history starts in October 2026'}
            onClick={onPrev}
          >
            ‹
          </button>
          <span className="budget-month-label" aria-live="polite">
            {monthLong}
          </span>
          <button type="button" className="budget-month-step" aria-label="Next month" onClick={onNext}>
            ›
          </button>
        </nav>
        <p className="muted small budget-month-caption">{progressCaption(progress)}</p>
      </div>
      <div className="budget-header-actions">
        <Link
          className="btn small ghost"
          to="/bills"
          onMouseEnter={() => prefetchNavTarget('/bills')}
          onFocus={() => prefetchNavTarget('/bills')}
        >
          Bills &amp; subscriptions
        </Link>
        <Link
          className="btn small ghost"
          to="/warranties"
          onMouseEnter={() => prefetchNavTarget('/warranties')}
          onFocus={() => prefetchNavTarget('/warranties')}
        >
          Warranties
        </Link>
        <div className="budget-add" ref={menuRef}>
          <button
            ref={toggleRef}
            type="button"
            className="btn small primary"
            aria-expanded={menuOpen}
            aria-controls="budget-add-options"
            onClick={() => setMenuOpen((o) => !o)}
          >
            + Add
          </button>
          {menuOpen ? (
            <ul id="budget-add-options" className="budget-add-options" aria-label="Add">
              {addActions.map((a) => (
                <li key={a.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      a.onSelect();
                    }}
                  >
                    {a.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </header>
  );
}
