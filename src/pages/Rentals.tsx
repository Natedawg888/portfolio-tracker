/**
 * Rental income (KAN-66). Reached from the Budget page (not the nav bar).
 * Properties, each with its rent and expenses for the selected tax year (1 April –
 * 31 March), and income / expenses / net totals. Entries can also count in Budget and
 * Income: rent as a "Rental income" income row, expenses as the matching bank debit or
 * else a "Rental property" spending transaction (the server keeps those in step with the entry).
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNzd, type RentalEntryWriteBody, type RentalPropertyWriteBody } from '../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { showQuietToast } from '../lib/quietToast';
import {
  RENTAL_CATEGORIES,
  rentalCategoryLabel,
  rentalTaxYears,
  rentalTotals,
  taxYearLabel,
  taxYearOf,
  taxYearRange,
  type RentalEntryKind,
} from '../lib/rental';
import { RadioChips } from '../components/warranties/RadioChips';
import { errText } from '../components/warranties/receiptFile';
import { longDate } from './warrantiesView';
import type { RentalEntry, RentalListResponse, RentalProperty } from '../types';

const RENTALS_KEY = 'rentals';

const KIND_OPTIONS = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => (e.target === e.currentTarget ? onClose() : undefined)}>
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="btn small modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormActions({ busy, disabled, saveLabel, hint, onSave, onClose }: {
  busy: boolean;
  disabled: boolean;
  saveLabel: string;
  hint: string | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const hintId = useId();
  return (
    <div className="row gap modal-actions warranty-form-actions">
      <button type="button" className="btn primary" disabled={busy || disabled} aria-describedby={hint ? hintId : undefined} onClick={onSave}>
        {saveLabel}
      </button>
      <button type="button" className="btn" onClick={onClose}>
        Cancel
      </button>
      {hint ? (
        <span id={hintId} className="muted small warranty-save-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function PropertyForm({ title, initial, onSave, onClose }: {
  title: string;
  initial: RentalPropertyWriteBody;
  onSave: (body: RentalPropertyWriteBody) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(d);
    } catch (e) {
      setError(errText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label className="span-2">
          Name
          <input value={d.name} maxLength={80} placeholder="e.g. Grey Lynn flat" autoFocus onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>
        <label className="span-2">
          Address (optional)
          <input value={d.address} maxLength={200} onChange={(e) => setD({ ...d, address: e.target.value })} />
        </label>
        <label className="span-2">
          Notes (optional)
          <input value={d.notes} maxLength={500} placeholder="e.g. tenant, lease end, property manager" onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions
        busy={busy}
        disabled={!d.name.trim()}
        saveLabel="Save property"
        hint={d.name.trim() ? null : 'Add a name'}
        onSave={() => void save()}
        onClose={onClose}
      />
    </Dialog>
  );
}

type EntryDraftForm = Omit<RentalEntryWriteBody, 'amountNzd'> & { amount: string };

function entryBlocker(d: EntryDraftForm): string | null {
  if (!d.propertyId) return 'Choose a property';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return 'Add a date';
  const n = Number(d.amount);
  if (d.amount.trim() === '' || !Number.isFinite(n) || n <= 0) return 'Add an amount';
  return null;
}

function EntryForm({ title, initial, properties, moneyViewsFrom, onSave, onClose }: {
  title: string;
  initial: EntryDraftForm;
  properties: RentalProperty[];
  moneyViewsFrom: string;
  onSave: (body: RentalEntryWriteBody) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kindLabel = useId();
  const blocker = entryBlocker(d);
  const set = <K extends keyof EntryDraftForm>(k: K, v: EntryDraftForm[K]) => setD((prev) => ({ ...prev, [k]: v }));

  function setKind(kind: RentalEntryKind) {
    setD((prev) => (prev.kind === kind ? prev : { ...prev, kind, category: RENTAL_CATEGORIES[kind][0].value }));
  }

  async function save() {
    if (blocker) return;
    setBusy(true);
    setError(null);
    try {
      const { amount, ...rest } = d;
      await onSave({ ...rest, amountNzd: Number(amount) });
    } catch (e) {
      setError(errText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  const where = d.kind === 'income' ? 'Income' : 'Budget spending';
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="form-grid warranty-form">
        <div className="span-2 warranty-field">
          <span id={kindLabel} className="warranty-field-label">
            Money
          </span>
          <RadioChips labelId={kindLabel} options={KIND_OPTIONS} value={d.kind} onChange={(v) => setKind(v as RentalEntryKind)} />
        </div>
        <label>
          Property
          <select value={d.propertyId} onChange={(e) => set('propertyId', e.target.value)}>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select value={d.category} onChange={(e) => set('category', e.target.value as EntryDraftForm['category'])}>
            {RENTAL_CATEGORIES[d.kind].map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label>
          Amount (NZD)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={d.amount} onChange={(e) => set('amount', e.target.value)} />
        </label>
        <label className="span-2">
          Description (optional)
          <input
            value={d.description}
            maxLength={120}
            placeholder={d.kind === 'income' ? 'e.g. Rent 1–14 Oct' : 'e.g. Hot water cylinder'}
            onChange={(e) => set('description', e.target.value)}
          />
        </label>
        <label className="span-2 rental-money-toggle">
          <span>
            <input type="checkbox" checked={d.addToMoney} onChange={(e) => set('addToMoney', e.target.checked)} /> Count in {where}
          </span>
          <span className="muted small">
            {d.kind === 'income'
              ? 'A matching bank deposit is linked so it isn’t counted twice.'
              : 'If the payment is in your bank transactions (same amount, within 10 days), it’s matched instead of added twice.'}
            {d.date && d.date < moneyViewsFrom ? ` Budget and Income start on ${longDate(moneyViewsFrom)}, so this one stays here only.` : ''}
          </span>
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} disabled={blocker != null} saveLabel="Save" hint={blocker} onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}

function Totals({ income, expenses, net }: { income: number; expenses: number; net: number }) {
  return (
    <dl className="rental-totals">
      <div>
        <dt>Income</dt>
        <dd>{formatNzd(income)}</dd>
      </div>
      <div>
        <dt>Expenses</dt>
        <dd>{formatNzd(expenses)}</dd>
      </div>
      <div>
        <dt>Net</dt>
        <dd className={net < 0 ? 'rental-net--loss' : undefined}>{formatNzd(net)}</dd>
      </div>
    </dl>
  );
}

function moneyNote(e: RentalEntry, moneyViewsFrom: string): string {
  if (e.bankMatch) return `In Budget · matched to ${e.bankMatch.description || 'bank payment'} on ${longDate(e.bankMatch.date)}`;
  if (e.inMoneyViews) return e.kind === 'income' ? 'In Income' : 'In Budget';
  if (!e.addToMoney) return 'Not in Budget';
  if (e.date < moneyViewsFrom) return 'Before Budget starts';
  return 'Removed from Budget · save to add back';
}

function PropertyCard({ property, entries, year, moneyViewsFrom, busy, onAdd, onEditEntry, onDeleteEntry, onEdit, onDelete }: {
  property: RentalProperty;
  entries: RentalEntry[];
  year: number;
  moneyViewsFrom: string;
  busy: boolean;
  onAdd: (kind: RentalEntryKind) => void;
  onEditEntry: (e: RentalEntry) => void;
  onDeleteEntry: (e: RentalEntry) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { start, end } = taxYearRange(year);
  const rows = entries.filter((e) => e.propertyId === property.id && e.date >= start && e.date <= end);
  return (
    <article className="panel warranty-card rental-card" aria-labelledby={`rental-${property.id}`}>
      <div className="rental-card-head">
        <div className="warranty-card-title">
          <h4 id={`rental-${property.id}`}>{property.name}</h4>
          {property.address ? <p className="warranty-card-sub">{property.address}</p> : null}
          {property.notes ? <p className="warranty-card-notes">{property.notes}</p> : null}
        </div>
        <div className="rental-card-actions">
          <button type="button" className="btn small" disabled={busy} onClick={() => onAdd('income')}>
            + Income
          </button>
          <button type="button" className="btn small" disabled={busy} onClick={() => onAdd('expense')}>
            + Expense
          </button>
          <button type="button" className="link-btn" disabled={busy} onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="link-btn" disabled={busy} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      <Totals {...rentalTotals(entries, year, property.id)} />
      {rows.length === 0 ? (
        <p className="muted small">Nothing recorded in {taxYearLabel(year)}.</p>
      ) : (
        <ul className="rental-entries">
          {rows.map((e) => (
            <li key={e.id} className="rental-entry">
              <div className="rental-entry-what">
                <span>{e.description || rentalCategoryLabel(e.category)}</span>
                <span className="muted small">
                  {longDate(e.date)} · {rentalCategoryLabel(e.category)} · {moneyNote(e, moneyViewsFrom)}
                </span>
              </div>
              <span className={'rental-entry-amount' + (e.kind === 'expense' ? ' rental-entry-amount--out' : '')}>
                {e.kind === 'expense' ? '−' : '+'}
                {formatNzd(e.amountNzd)}
              </span>
              <span className="rental-entry-actions">
                <button type="button" className="link-btn" disabled={busy} onClick={() => onEditEntry(e)}>
                  Edit
                </button>
                <button type="button" className="link-btn" disabled={busy} onClick={() => onDeleteEntry(e)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

type DialogState =
  | { mode: 'add-property' }
  | { mode: 'edit-property'; item: RentalProperty }
  | { mode: 'add-entry'; draft: EntryDraftForm }
  | { mode: 'edit-entry'; item: RentalEntry }
  | null;

export function Rentals() {
  const [data, setData] = useState<RentalListResponse | null>(() => readPageCache<RentalListResponse>(RENTALS_KEY) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const load = () => setReload((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    const stamp = beginPageRead(RENTALS_KEY);
    api.rentals
      .list()
      .then((d) => {
        if (!commitPageRead(stamp, d) || cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (readPageCache<RentalListResponse>(RENTALS_KEY) != null) {
          showQuietToast('Could not refresh rentals — showing last data.', { kind: 'warn' });
          return;
        }
        setError(errText(e, 'Could not load rentals.'));
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function act(fn: () => Promise<unknown>, note: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(note);
      load();
    } catch (e) {
      setError(errText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  async function saved(note: string) {
    setDialog(null);
    setMsg(note);
    load();
  }

  const today = data?.today ?? '';
  const properties = data?.properties ?? [];
  const entries = data?.entries ?? [];
  const years = today ? rentalTaxYears(entries, today) : [];
  const shownYear = year ?? (today ? taxYearOf(today) : null);
  const yearIdx = shownYear == null ? -1 : years.indexOf(shownYear);

  function addEntry(kind: RentalEntryKind, propertyId = properties[0]?.id ?? '') {
    setDialog({
      mode: 'add-entry',
      draft: { propertyId, kind, category: RENTAL_CATEGORIES[kind][0].value, date: today, amount: '', description: '', addToMoney: true },
    });
  }

  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name ?? 'the property';

  return (
    <div className="stack bills-page warranties-page rentals-page">
      <header className="warranties-header">
        <div>
          <Link className="warranties-back" to="/spending">
            ‹ Budget
          </Link>
          <h2 className="page-title">Rental income</h2>
          {shownYear != null && properties.length > 0 ? (
            <nav className="budget-month-switch" aria-label="Tax year">
              <button
                type="button"
                className="budget-month-step"
                disabled={yearIdx < 0 || yearIdx >= years.length - 1}
                aria-label="Previous tax year"
                onClick={() => setYear(years[yearIdx + 1])}
              >
                ‹
              </button>
              <span className="budget-month-label" aria-live="polite">
                {taxYearLabel(shownYear)} tax year
              </span>
              <button
                type="button"
                className="budget-month-step"
                disabled={yearIdx <= 0}
                aria-label="Next tax year"
                onClick={() => setYear(years[yearIdx - 1])}
              >
                ›
              </button>
            </nav>
          ) : null}
        </div>
        {properties.length > 0 ? (
          <div className="warranties-header-actions">
            <button type="button" className="btn small" onClick={() => setDialog({ mode: 'add-property' })}>
              + Add property
            </button>
            <button type="button" className="btn small primary" onClick={() => addEntry('income')}>
              + Add entry
            </button>
          </div>
        ) : null}
      </header>

      {error ? (
        <section className="panel">
          <p className="auth-error" role="alert">{error}</p>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setError(null);
              load();
            }}
          >
            Try again
          </button>
        </section>
      ) : null}
      {msg ? <p className="banner">{msg}</p> : null}
      {!data && !error ? <p className="muted">Loading rentals…</p> : null}

      {data && properties.length === 0 ? (
        <section className="panel warranties-empty" aria-labelledby="rentals-empty-title">
          <h3 id="rentals-empty-title">Track a rental property</h3>
          <p>Record the rent and what the property costs you. The net rolls into your Budget and Income.</p>
          <button type="button" className="btn primary" onClick={() => setDialog({ mode: 'add-property' })}>
            Add your first property
          </button>
        </section>
      ) : null}

      {data && properties.length > 0 && shownYear != null ? (
        <>
          <section className="panel rental-summary" aria-label={`All properties, ${taxYearLabel(shownYear)}`}>
            <p className="muted small rental-summary-label">
              All properties · 1 Apr {shownYear - 1} – 31 Mar {shownYear}
            </p>
            <Totals {...rentalTotals(entries, shownYear)} />
          </section>
          <section className="warranty-card-list" aria-label="Properties">
            {properties.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                entries={entries}
                year={shownYear}
                moneyViewsFrom={data.moneyViewsFrom}
                busy={busy}
                onAdd={(kind) => addEntry(kind, p.id)}
                onEditEntry={(e) => setDialog({ mode: 'edit-entry', item: e })}
                onDeleteEntry={(e) =>
                  void act(
                    () => api.rentals.removeEntry(e.id),
                    'Entry deleted.',
                    `Delete this ${e.kind === 'income' ? 'income' : 'expense'} of ${formatNzd(e.amountNzd)}?${e.inMoneyViews ? ' It is removed from Budget and Income too.' : ''}`,
                  )
                }
                onEdit={() => setDialog({ mode: 'edit-property', item: p })}
                onDelete={() =>
                  void act(
                    () => api.rentals.removeProperty(p.id),
                    `${p.name} deleted.`,
                    `Delete ${p.name} and everything recorded for it? Its rent and expenses are removed from Budget and Income too.`,
                  )
                }
              />
            ))}
          </section>
          <p className="warranties-cga">
            Totals run over the tax year, 1 April to 31 March. What you can deduct (mortgage interest especially) depends on
            IRD’s current rules, so check before filing your IR3R. General information, not tax advice.
          </p>
        </>
      ) : null}

      {dialog?.mode === 'add-property' ? (
        <PropertyForm
          title="Add property"
          initial={{ name: '', address: '', notes: '' }}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.rentals.createProperty(body);
            await saved(`${body.name.trim()} added.`);
          }}
        />
      ) : null}
      {dialog?.mode === 'edit-property' ? (
        <PropertyForm
          title={`Edit ${dialog.item.name}`}
          initial={{ name: dialog.item.name, address: dialog.item.address, notes: dialog.item.notes }}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.rentals.updateProperty(dialog.item.id, body);
            await saved(`${body.name.trim()} updated.`);
          }}
        />
      ) : null}
      {dialog?.mode === 'add-entry' ? (
        <EntryForm
          title="Add rental income or expense"
          initial={dialog.draft}
          properties={properties}
          moneyViewsFrom={data?.moneyViewsFrom ?? ''}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.rentals.createEntry(body);
            if (taxYearOf(body.date) !== shownYear) setYear(taxYearOf(body.date));
            await saved(`${body.kind === 'income' ? 'Income' : 'Expense'} added to ${propertyName(body.propertyId)}.`);
          }}
        />
      ) : null}
      {dialog?.mode === 'edit-entry' ? (
        <EntryForm
          title="Edit entry"
          initial={{
            propertyId: dialog.item.propertyId,
            kind: dialog.item.kind,
            category: dialog.item.category,
            date: dialog.item.date,
            amount: String(dialog.item.amountNzd),
            description: dialog.item.description,
            addToMoney: dialog.item.addToMoney,
          }}
          properties={properties}
          moneyViewsFrom={data?.moneyViewsFrom ?? ''}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.rentals.updateEntry(dialog.item.id, body);
            await saved('Entry updated.');
          }}
        />
      ) : null}
    </div>
  );
}
