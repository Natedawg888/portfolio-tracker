/**
 * Prominent create-time type toggle for transaction categories.
 * Must be chosen when adding a category — not buried in advanced settings.
 */
import {
  CATEGORY_TYPES,
  CATEGORY_TYPE_LABELS,
  type CategoryType,
} from '../lib/categoryTypes';

const HINTS: Record<CategoryType, string> = {
  spending: 'Counts toward Budget / spend charts',
  income: 'Planned vs received income',
  transfer_out: 'Leaving an account — not spend',
  transfer_in: 'Entering an account — not income',
};

type Props = {
  value: CategoryType;
  onChange: (next: CategoryType) => void;
  disabled?: boolean;
  /** Visible legend above the toggle (default: Category type) */
  label?: string;
};

export function CategoryTypeToggle({
  value,
  onChange,
  disabled = false,
  label = 'Category type',
}: Props) {
  return (
    <fieldset className="category-type-toggle" disabled={disabled}>
      <legend className="category-type-toggle-legend">{label}</legend>
      <div
        className="category-type-toggle-row"
        role="radiogroup"
        aria-label={label}
      >
        {CATEGORY_TYPES.map((t) => {
          const active = value === t;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={active}
              className={active ? 'category-type-btn active' : 'category-type-btn'}
              disabled={disabled}
              onClick={() => onChange(t)}
            >
              {CATEGORY_TYPE_LABELS[t]}
            </button>
          );
        })}
      </div>
      <p className="category-type-toggle-hint muted small" role="status">
        {HINTS[value]}
      </p>
    </fieldset>
  );
}
