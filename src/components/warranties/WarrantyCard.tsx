import { useId, useState } from 'react';
import { formatNzd } from '../../api/client';
import type { Warranty } from '../../types';
import { MoreMenu } from '../MoreMenu';
import {
  WARRANTY_STATUS_LABELS,
  coverProgress,
  datesLine,
  longDate,
  receiptFor,
  storePriceLine,
} from '../../pages/warrantiesView';

export function WarrantyCard({
  warranty: w,
  today,
  busy,
  onEdit,
  onDelete,
}: {
  warranty: Warranty;
  today: string;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ids = { title: useId(), purchase: useId() };
  const [showPurchase, setShowPurchase] = useState(false);
  const progress = coverProgress(w, today);
  const receipt = receiptFor(w);

  return (
    <article className={`card warranty-card warranty-card--${w.status}`} aria-labelledby={ids.title}>
      <div className="warranty-card-head">
        <div className="warranty-card-title">
          <h4 id={ids.title}>{w.itemName}</h4>
          <p className="warranty-card-sub">{storePriceLine(w, formatNzd)}</p>
        </div>
        <span className={`warranty-status warranty-status--${w.status}`}>{WARRANTY_STATUS_LABELS[w.status]}</span>
        <MoreMenu menu label={`More actions for ${w.itemName}`}>
          {(close) => (
            <>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="btn small"
                onClick={() => {
                  close();
                  onEdit();
                }}
              >
                Edit
              </button>
              {receipt ? (
                <a role="menuitem" tabIndex={-1} className="btn small" href={receipt} target="_blank" rel="noreferrer" onClick={close}>
                  View receipt
                </a>
              ) : null}
              {w.purchase ? (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="btn small"
                  aria-expanded={showPurchase}
                  aria-controls={ids.purchase}
                  onClick={() => {
                    close();
                    setShowPurchase((v) => !v);
                  }}
                >
                  {showPurchase ? 'Hide transaction' : 'View transaction'}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="btn small danger"
                disabled={busy}
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                Delete
              </button>
            </>
          )}
        </MoreMenu>
      </div>

      <div
        className="warranty-progress"
        role="progressbar"
        aria-label={progress.label}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.used}
        aria-valuetext={progress.label}
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>

      <p className="warranty-card-dates">{datesLine(w, today)}</p>
      {w.notes ? <p className="warranty-card-notes">{w.notes}</p> : null}

      {showPurchase && w.purchase ? (
        <div id={ids.purchase} className="warranty-purchase">
          <p>
            <span className="warranty-purchase-label">Linked transaction</span>
            {w.purchase.description || 'Purchase'} · {longDate(w.purchase.date)} · <span className="money">{formatNzd(w.purchase.amountNzd)}</span>
          </p>
          <p className="warranty-purchase-actions">
            {w.purchase.receiptUrl ? (
              <a href={w.purchase.receiptUrl} target="_blank" rel="noreferrer">
                Transaction receipt
              </a>
            ) : null}
            <button type="button" className="link-btn" onClick={() => setShowPurchase(false)}>
              Hide
            </button>
          </p>
        </div>
      ) : null}
    </article>
  );
}
