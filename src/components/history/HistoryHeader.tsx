/**
 * History page header: ‹ History · Year › (arrows jump to the nearest year with
 * snapshots), a snapshot-count caption with an ⓘ, and "Snapshot now".
 */
import { InfoTip } from '../InfoTip';

export function HistoryHeader({
  year,
  snapshotCount,
  prevYear,
  nextYear,
  onSelectYear,
  saving,
  onSnapshotNow,
}: {
  year: number;
  snapshotCount: number;
  prevYear: number | null;
  nextYear: number | null;
  onSelectYear: (year: number) => void;
  saving: boolean;
  onSnapshotNow: () => void;
}) {
  return (
    <header className="history-header">
      <div className="history-header-main">
        <nav className="history-year-switch" aria-label="History year">
          <button
            type="button"
            className="history-year-step"
            disabled={prevYear == null}
            aria-label="Previous year with snapshots"
            title={prevYear == null ? 'No earlier snapshots' : `Go to ${prevYear}`}
            onClick={() => prevYear != null && onSelectYear(prevYear)}
          >
            ‹
          </button>
          <h2 className="page-title history-header-title" aria-live="polite">
            History · {year}
          </h2>
          <button
            type="button"
            className="history-year-step"
            disabled={nextYear == null}
            aria-label="Next year with snapshots"
            title={nextYear == null ? 'No later snapshots' : `Go to ${nextYear}`}
            onClick={() => nextYear != null && onSelectYear(nextYear)}
          >
            ›
          </button>
        </nav>
        <p className="muted small history-header-caption">
          {snapshotCount} snapshot{snapshotCount === 1 ? '' : 's'} · from real snapshots only
          <InfoTip label="About history">
            Every point is a saved snapshot of your balances. Empty days or months stay empty;
            nothing is filled in or estimated. Years follow the New Zealand calendar.
          </InfoTip>
        </p>
      </div>
      <button type="button" className="btn small primary" disabled={saving} onClick={onSnapshotNow}>
        {saving ? 'Saving…' : 'Snapshot now'}
      </button>
    </header>
  );
}
