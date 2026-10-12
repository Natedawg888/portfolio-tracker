import { useId } from 'react';
import { formatNzd } from '../../api/client';
import type { RecurringListResponse } from '../../types';
import { dismissLabel, suggestionFacts, suggestionTitle } from '../../pages/billsView';

type Suggestion = RecurringListResponse['suggestions'][number];

export function SuggestionCard({
  suggestion: s,
  today,
  busy,
  onTrack,
  onDismiss,
}: {
  suggestion: Suggestion;
  today: string;
  busy: boolean;
  onTrack: () => void;
  onDismiss: () => void;
}) {
  const titleId = useId();
  return (
    <article className="card bills-suggestion" aria-labelledby={titleId}>
      <div className="bills-suggestion-head">
        <h4 id={titleId}>{suggestionTitle(s)}</h4>
        <span className="bills-suggestion-amount money">{formatNzd(s.amountNzd)}</span>
      </div>
      <p className="bills-suggestion-facts">
        {s.tier === 'possible' ? <span className="bills-chip">Lower confidence</span> : null}
        {suggestionFacts(s, today).join(' · ')}
      </p>
      <div className="bills-suggestion-actions">
        <button type="button" className="btn small primary" disabled={busy} onClick={onTrack}>
          Track
        </button>
        <button type="button" className="btn small ghost" disabled={busy} onClick={onDismiss}>
          {dismissLabel(s)}
        </button>
      </div>
    </article>
  );
}
