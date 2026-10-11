/**
 * "Spending by category": planned categories (spent of plan, pace marker, status)
 * and categories with spending but no plan yet. Rows open an inline plan editor.
 */
import { useId, useState, type FormEvent } from 'react';
import { formatNzd } from '../../api/client';
import { MONEY_MASK, useMoneyHidden } from '../../lib/privacy';
import { planStatus, type MonthProgress, type PlanStatus } from '../../lib/budgetView';

export type PlannedRow = {
  budgetId: string;
  categoryId: string;
  name: string;
  colour: string;
  planned: number;
  spent: number;
};

export type UnplannedRow = { categoryId: string; name: string; colour: string; spent: number };

type Props = {
  monthLong: string;
  progress: MonthProgress;
  planned: PlannedRow[];
  unplanned: UnplannedRow[];
  uncategorisedSpend: number;
  /** Spending categories with no plan this month, for "Plan another category". */
  addable: Array<{ id: string; name: string }>;
  saving: boolean;
  /** Resolves true when saved. */
  onSavePlan: (categoryId: string, amount: number) => Promise<boolean>;
  onRemovePlan: (budgetId: string, name: string) => Promise<void>;
  onSeeTransactions: (categoryId: string) => void;
  onManageCategories: () => void;
};

function statusText(s: PlanStatus, hidden: boolean): string {
  const pct = (n: number | null) => (n == null ? 'no amount planned' : hidden ? `${MONEY_MASK}% of plan` : `${n}% of plan`);
  switch (s.kind) {
    case 'over':
      return `Over by ${formatNzd(s.overBy)} · ${pct(s.percent)}`;
    case 'ahead':
      return `Ahead of pace · ${formatNzd(s.left)} left`;
    case 'within':
      return `Within plan · ${formatNzd(s.left)} left`;
    default:
      return `On track · ${formatNzd(s.left)} left`;
  }
}

function parseAmount(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function CategoryBudgetList(props: Props) {
  const { planned, unplanned, uncategorisedSpend, progress, monthLong } = props;
  const hidden = useMoneyHidden();
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const maxUnplanned = Math.max(0, ...unplanned.map((r) => r.spent));
  const toggle = (categoryId: string) => setOpenId((cur) => (cur === categoryId ? null : categoryId));

  return (
    <section className="panel category-budget" aria-labelledby="category-budget-title">
      <div className="panel-heading">
        <h3 id="category-budget-title">Spending by category</h3>
        <button type="button" className="btn small ghost" onClick={props.onManageCategories}>
          Manage categories
        </button>
      </div>

      <h4 className="section-subtitle">Planned</h4>
      {planned.length === 0 ? (
        <p className="muted small">No plans for {monthLong} yet.</p>
      ) : (
        <ul className="category-budget-list">
          {planned.map((row) => {
            const status = planStatus(row.spent, row.planned, progress);
            const fill = row.planned > 0 ? Math.min(100, (row.spent / row.planned) * 100) : row.spent > 0 ? 100 : 0;
            const open = openId === row.categoryId;
            const editorId = `plan-editor-${row.categoryId}`;
            return (
              <li key={row.budgetId} className={`category-budget-row category-budget-row--${status.kind}`}>
                <button
                  type="button"
                  className="category-budget-hit"
                  aria-expanded={open}
                  aria-controls={open ? editorId : undefined}
                  onClick={() => toggle(row.categoryId)}
                >
                  <span className="category-budget-top">
                    <span className="category-budget-name">
                      <span className="category-dot" style={{ background: row.colour }} aria-hidden="true" />
                      {row.name}
                    </span>
                    <span className="money">
                      {formatNzd(row.spent)} <span className="muted">of {formatNzd(row.planned)}</span>
                    </span>
                  </span>
                  {hidden ? null : (
                    <span className="category-budget-bar" aria-hidden="true">
                      <span className="category-budget-fill" style={{ width: `${fill}%`, background: row.colour }} />
                      {progress.state === 'current' ? (
                        <span className="category-budget-pace" style={{ left: `${progress.fraction * 100}%` }} />
                      ) : null}
                    </span>
                  )}
                  <span className={`category-budget-status category-budget-status--${status.kind}`}>
                    {status.kind === 'over' ? <span aria-hidden="true">▲ </span> : null}
                    {statusText(status, hidden)}
                  </span>
                </button>
                {open ? (
                  <PlanEditor
                    id={editorId}
                    name={row.name}
                    initial={String(row.planned)}
                    saving={props.saving}
                    onSave={async (amount) => {
                      if (await props.onSavePlan(row.categoryId, amount)) setOpenId(null);
                    }}
                    onRemove={() => props.onRemovePlan(row.budgetId, row.name).then(() => setOpenId(null))}
                    onSeeTransactions={() => props.onSeeTransactions(row.categoryId)}
                    onCancel={() => setOpenId(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {progress.state === 'current' && planned.length > 0 && !hidden ? (
        <p className="muted small category-budget-legend">
          <span className="category-budget-pace-key" aria-hidden="true" /> marks today: how far through the month you are.
        </p>
      ) : null}

      {props.addable.length > 0 ? (
        addOpen ? (
          <AddPlanForm
            categories={props.addable}
            saving={props.saving}
            onSave={async (categoryId, amount) => {
              if (await props.onSavePlan(categoryId, amount)) setAddOpen(false);
            }}
            onCancel={() => setAddOpen(false)}
          />
        ) : (
          <button type="button" className="btn small ghost category-budget-add" onClick={() => setAddOpen(true)}>
            + Plan another category
          </button>
        )
      ) : null}

      <h4 className="section-subtitle">No plan yet</h4>
      {unplanned.length === 0 ? (
        <p className="muted small">
          {planned.length > 0 ? 'Every category you spent in this month has a plan.' : `No spending in ${monthLong} yet.`}
        </p>
      ) : (
        <ul className="category-budget-list">
          {unplanned.map((row) => {
            const open = openId === row.categoryId;
            const editorId = `plan-editor-${row.categoryId}`;
            return (
              <li key={row.categoryId} className="category-budget-row">
                <div className="category-budget-unplanned">
                  <span className="category-budget-top">
                    <span className="category-budget-name">
                      <span className="category-dot" style={{ background: row.colour }} aria-hidden="true" />
                      {row.name}
                    </span>
                    <span className="money">{formatNzd(row.spent)}</span>
                  </span>
                  {hidden ? null : (
                    <span className="category-budget-bar" aria-hidden="true">
                      <span
                        className="category-budget-fill"
                        style={{ width: `${maxUnplanned > 0 ? (row.spent / maxUnplanned) * 100 : 0}%`, background: row.colour }}
                      />
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn small category-budget-set"
                    aria-expanded={open}
                    aria-controls={open ? editorId : undefined}
                    onClick={() => toggle(row.categoryId)}
                  >
                    Set plan<span className="sr-only"> for {row.name}</span>
                  </button>
                </div>
                {open ? (
                  <PlanEditor
                    id={editorId}
                    name={row.name}
                    initial=""
                    saving={props.saving}
                    onSave={async (amount) => {
                      if (await props.onSavePlan(row.categoryId, amount)) setOpenId(null);
                    }}
                    onSeeTransactions={() => props.onSeeTransactions(row.categoryId)}
                    onCancel={() => setOpenId(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {uncategorisedSpend > 0 ? (
        <p className="muted small category-budget-uncat">
          Plus {formatNzd(uncategorisedSpend)} not yet categorised, so it isn’t in any plan.
        </p>
      ) : null}
    </section>
  );
}

/** Inline "Monthly plan" editor, shared with the income card. */
export function PlanEditor({
  id,
  name,
  initial,
  saving,
  onSave,
  onRemove,
  onSeeTransactions,
  onCancel,
}: {
  id: string;
  name: string;
  initial: string;
  saving: boolean;
  onSave: (amount: number) => Promise<void>;
  onRemove?: () => Promise<void>;
  /** Omitted where there is no transaction list to jump to (income). */
  onSeeTransactions?: () => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const amount = parseAmount(value);
    if (amount == null) {
      setError('Enter a plan of 0 or more.');
      return;
    }
    setError(null);
    void onSave(amount);
  }

  return (
    <form
      id={id}
      className="plan-editor"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <label htmlFor={inputId}>Monthly plan for {name} (NZD)</label>
      <div className="plan-editor-row">
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          autoFocus
        />
        <button type="submit" className="btn small primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {onRemove ? (
          <button type="button" className="btn small danger" disabled={saving} onClick={() => void onRemove()}>
            Remove plan
          </button>
        ) : null}
        <button type="button" className="btn small ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        {onSeeTransactions ? (
          <button type="button" className="btn small ghost plan-editor-see" onClick={onSeeTransactions}>
            See transactions →
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="plan-editor-error" role="alert">{error}</p>
      ) : null}
    </form>
  );
}

function AddPlanForm({
  categories,
  saving,
  onSave,
  onCancel,
}: {
  categories: Array<{ id: string; name: string }>;
  saving: boolean;
  onSave: (categoryId: string, amount: number) => Promise<void>;
  onCancel: () => void;
}) {
  const selectId = useId();
  const amountId = useId();
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const amount = parseAmount(value);
    if (!categoryId || amount == null) {
      setError('Choose a category and enter a plan of 0 or more.');
      return;
    }
    setError(null);
    void onSave(categoryId, amount);
  }

  return (
    <form className="plan-editor plan-editor--add" onSubmit={submit}>
      <div className="plan-editor-row">
        <label htmlFor={selectId} className="sr-only">
          Category
        </label>
        <select id={selectId} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={saving}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label htmlFor={amountId} className="sr-only">
          Monthly plan (NZD)
        </label>
        <input
          id={amountId}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          placeholder="Monthly plan"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          autoFocus
        />
        <button type="submit" className="btn small primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save plan'}
        </button>
        <button type="button" className="btn small ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error ? (
        <p className="plan-editor-error" role="alert">{error}</p>
      ) : null}
    </form>
  );
}
