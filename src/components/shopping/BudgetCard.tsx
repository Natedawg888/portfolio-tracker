/**
 * Shopping list budget card: "Still to buy" as the big figure, the list total and how many
 * items have no price, and for each budget category on the list a bar of spent this month
 * plus this list against the month's plan. Totals sit in a polite live region.
 */
import { formatNzd } from '../../api/client';
import type { ShoppingListDetail } from '../../types';
import { budgetBar } from '../../lib/shoppingView';

export function BudgetCard({ list, onChangeCategory }: { list: ShoppingListDetail; onChangeCategory: () => void }) {
  const { toBuyNzd, estimatedNzd, unpricedCount } = list.totals;
  // The list's own category first, then any other categories items use.
  const lines = [...list.budget].sort((a, b) => Number(b.categoryId === list.categoryId) - Number(a.categoryId === list.categoryId));

  return (
    <section className="panel shop-budget-card" aria-label="Budget">
      <div className="shop-budget-top" aria-live="polite" aria-atomic="true">
        <div>
          <p className="shop-budget-label">Still to buy</p>
          <p className="shop-budget-figure">{formatNzd(toBuyNzd)}</p>
        </div>
        <p className="shop-budget-side">
          List {formatNzd(estimatedNzd)}
          {unpricedCount ? (
            <>
              <br />
              {unpricedCount} without a price
            </>
          ) : null}
        </p>
      </div>

      {list.categoryId == null && lines.length === 0 ? (
        <p className="shop-budget-note">
          Not linked to a budget category.{' '}
          <button type="button" className="link-btn shop-cat-link" onClick={onChangeCategory}>
            Choose one
          </button>
        </p>
      ) : null}

      {lines.map((b) => {
        const isList = b.categoryId === list.categoryId;
        const name = isList ? (
          <button type="button" className="link-btn shop-cat-link" aria-label={`${b.categoryName}, change the list’s budget category`} onClick={onChangeCategory}>
            {b.categoryName}
          </button>
        ) : (
          <strong>{b.categoryName}</strong>
        );
        if (b.plannedNzd == null || b.remainingNzd == null) {
          return (
            <div key={b.categoryId} className="shop-budget-line">
              <div className="shop-budget-cat">{name}</div>
              <p className="shop-budget-note">
                No plan this month · spent {formatNzd(b.spentNzd)} · this list {formatNzd(b.toBuyNzd)}
              </p>
            </div>
          );
        }
        const bar = budgetBar(b.plannedNzd, b.spentNzd, b.toBuyNzd);
        const label = `${b.categoryName}: spent ${formatNzd(b.spentNzd)} and this list ${formatNzd(b.toBuyNzd)} of a ${formatNzd(b.plannedNzd)} plan`;
        return (
          <div key={b.categoryId} className={'shop-budget-line' + (bar.over ? ' is-over' : '')}>
            <div className="shop-budget-cat">{name}</div>
            <div className="shop-bar" role="img" aria-label={label}>
              <span className="shop-bar-spent" style={{ width: `${bar.spentPct}%` }} />
              <span className="shop-bar-list" style={{ width: `${bar.listPct}%` }} />
              {bar.planMarkPct != null ? <span className="shop-bar-plan" style={{ left: `${bar.planMarkPct}%` }} /> : null}
            </div>
            <p className="shop-budget-note">
              {formatNzd(b.remainingNzd)} left of {formatNzd(b.plannedNzd)} this month ·{' '}
              {bar.over ? (
                <strong className="shop-over">{formatNzd(bar.overBy)} over after this list</strong>
              ) : (
                <>{formatNzd(bar.afterList)} after this list</>
              )}
            </p>
            <p className="shop-bar-key" aria-hidden="true">
              <span className="shop-key shop-key-spent" /> Spent <span className="shop-key shop-key-list" /> This list
            </p>
          </div>
        );
      })}
    </section>
  );
}
