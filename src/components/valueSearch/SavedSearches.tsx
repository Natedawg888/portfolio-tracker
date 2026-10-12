import { useId } from 'react';
import { SEARCH_TYPE_LABEL } from '../../lib/valueSearchDetect';
import type { SavedSearch } from '../../lib/valueSearchView';

/** A row of one-tap searches: "Things you own" or recent searches. Renders nothing when empty. */
export function SavedSearches({
  title,
  searches,
  onRun,
  onClear,
  clearLabel,
}: {
  title: string;
  searches: readonly (SavedSearch & { label?: string })[];
  onRun: (search: SavedSearch) => void;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const headingId = useId();
  if (searches.length === 0) return null;
  return (
    <section className="vs-saved" aria-labelledby={headingId}>
      <div className="vs-saved-head">
        <h3 id={headingId}>{title}</h3>
        {onClear ? (
          <button type="button" className="btn small" aria-label={clearLabel} onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="txn-pills">
        {searches.map((s) => (
          <button key={`${s.type}:${s.query}`} type="button" className="txn-pill" onClick={() => onRun(s)}>
            {s.label ?? s.query}
            <span className="txn-pill-count">· {SEARCH_TYPE_LABEL[s.type]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
