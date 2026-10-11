/**
 * Inline panel under the Dashboard tiles listing what makes up one asset class.
 * Rows come from /net-worth holdings (the same lines the class total is built
 * from); Cash passes its accounts table as children instead.
 */
import { useEffect, type ReactNode } from 'react';
import { formatNzd } from '../api/client';

export type DrillHolding = { id: string; label: string; valueNzd: number };

export function AssetDrillDown({
  id,
  title,
  holdings,
  note,
  onClose,
  children,
}: {
  id: string;
  title: string;
  /** Omit when children carry the content; null while the list isn't loaded yet. */
  holdings?: DrillHolding[] | null;
  note?: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sorted = holdings ? [...holdings].sort((a, b) => b.valueNzd - a.valueNzd) : holdings;

  return (
    <section id={id} className="panel asset-drill" aria-labelledby={`${id}-heading`}>
      <div className="asset-drill-head">
        <h2 id={`${id}-heading`}>{title}</h2>
        <button type="button" className="btn small ghost" onClick={onClose} aria-label={`Close ${title}`}>
          ×
        </button>
      </div>
      {children}
      {sorted === null ? (
        <p className="muted small">Loading details…</p>
      ) : sorted ? (
        sorted.length === 0 ? (
          <p className="muted small">Nothing recorded in this class yet.</p>
        ) : (
          <ul className="asset-drill-list">
            {sorted.map((h) => (
              <li key={h.id}>
                <span className="asset-drill-label">{h.label}</span>
                <span className="money">{formatNzd(h.valueNzd)}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {note ? <p className="muted small asset-drill-note">{note}</p> : null}
    </section>
  );
}
