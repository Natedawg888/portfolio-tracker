/**
 * Rental income (KAN-66). Reached from the Budget page (not the nav bar).
 * Properties, each with its rent and expenses for the selected tax year (1 April –
 * 31 March), and income / expenses / net totals. Entries can also count in Budget and
 * Income: rent as a "Rental income" income row, expenses as the matching bank debit or
 * else a "Rental property" spending transaction (the server keeps those in step with the entry).
 * A property can be let room by room, including your own home (KAN-83): rooms, tenancies,
 * occupancy and rent per room, and expenses shared across the rooms.
 * Tax (KAN-93, src/lib/rentalTax.ts): interest at 80% in 2024/25, ring-fenced losses carried
 * forward (portfolio or per property), and the bright-line test on a sold property.
 */
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  formatNzd,
  type RentalEntryWriteBody,
  type RentalPropertyWriteBody,
  type RentalTenancyWriteBody,
} from '../api/client';
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
import {
  IRD_BRIGHT_LINE_URL,
  IRD_INTEREST_URL,
  IRD_RING_FENCING_URL,
  brightLine,
  rentalTaxYear,
  type LossBasis,
  type PropertyTaxYear,
  type RentalTaxYear,
} from '../lib/rentalTax';
import { RadioChips } from '../components/warranties/RadioChips';
import { errText } from '../components/warranties/receiptFile';
import { Dialog, FormActions } from '../components/rentals/RentalDialog';
import { RoomForm, TenancyForm } from '../components/rentals/RoomForms';
import { RoomsPanel, type RoomActions } from '../components/rentals/RoomsPanel';
import { longDate } from './warrantiesView';
import type { RentalEntry, RentalListResponse, RentalProperty, RentalRoom, RentalTenancy } from '../types';

const RENTALS_KEY = 'rentals';

const KIND_OPTIONS = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
];

const LET_OPTIONS = [
  { value: 'whole', label: 'Whole property' },
  { value: 'rooms', label: 'Room by room' },
];

const BASIS_OPTIONS = [
  { value: 'portfolio', label: 'All properties together' },
  { value: 'property', label: 'Each property on its own' },
];

const EMPTY_PROPERTY: RentalPropertyWriteBody = {
  name: '',
  address: '',
  notes: '',
  letType: 'whole',
  ownHome: false,
  newBuild: false,
  purchaseDate: null,
  purchaseCostNzd: null,
  saleAgreementDate: null,
  salePriceNzd: null,
  saleCostsNzd: null,
  mainHome: false,
};

const moneyIn = (v: string): number | null => (v.trim() === '' ? null : Number(v));

function PropertyForm({ title, initial, onSave, onClose }: {
  title: string;
  initial: RentalPropertyWriteBody;
  onSave: (body: RentalPropertyWriteBody) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [sold, setSold] = useState(initial.saleAgreementDate != null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const letLabel = useId();
  const ownHome = d.letType === 'rooms' && d.ownHome;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        ...d,
        ownHome,
        ...(sold ? {} : { saleAgreementDate: null, salePriceNzd: null, saleCostsNzd: null }),
      });
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
        <div className="span-2 warranty-field">
          <span id={letLabel} className="warranty-field-label">
            Let as
          </span>
          <RadioChips labelId={letLabel} options={LET_OPTIONS} value={d.letType} onChange={(v) => setD({ ...d, letType: v as RentalProperty['letType'] })} />
        </div>
        {d.letType === 'rooms' ? (
          <label className="span-2 rental-money-toggle">
            <span>
              <input type="checkbox" checked={d.ownHome} onChange={(e) => setD({ ...d, ownHome: e.target.checked })} /> I live here (boarders or
              flatmates in my home)
            </span>
          </label>
        ) : null}
        <label className="span-2">
          Address (optional)
          <input value={d.address} maxLength={200} onChange={(e) => setD({ ...d, address: e.target.value })} />
        </label>
        <label className="span-2">
          Notes (optional)
          <input value={d.notes} maxLength={500} placeholder="e.g. tenant, lease end, property manager" onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </label>
        <p className="span-2 rental-form-section">For tax (optional)</p>
        <label className="span-2 rental-money-toggle">
          <span>
            <input type="checkbox" checked={d.newBuild} onChange={(e) => setD({ ...d, newBuild: e.target.checked })} /> New build (code compliance
            certificate on or after 27 March 2020)
          </span>
          <span className="muted small">New builds aren’t under the interest limitation.</span>
        </label>
        <label>
          Purchase settled on
          <input type="date" value={d.purchaseDate ?? ''} onChange={(e) => setD({ ...d, purchaseDate: e.target.value || null })} />
        </label>
        <label>
          Cost (NZD)
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={d.purchaseCostNzd ?? ''}
            placeholder="Price + buying costs + improvements"
            onChange={(e) => setD({ ...d, purchaseCostNzd: moneyIn(e.target.value) })}
          />
        </label>
        <label className="span-2 rental-money-toggle">
          <span>
            <input type="checkbox" checked={sold} onChange={(e) => setSold(e.target.checked)} /> I’ve sold it
          </span>
        </label>
        {sold ? (
          <>
            <label>
              Sale agreement signed on
              <input type="date" value={d.saleAgreementDate ?? ''} onChange={(e) => setD({ ...d, saleAgreementDate: e.target.value || null })} />
            </label>
            <label>
              Sale price (NZD)
              <input type="number" min={0} step="0.01" inputMode="decimal" value={d.salePriceNzd ?? ''} onChange={(e) => setD({ ...d, salePriceNzd: moneyIn(e.target.value) })} />
            </label>
            <label>
              Selling costs (NZD)
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={d.saleCostsNzd ?? ''}
                placeholder="Agent, legal"
                onChange={(e) => setD({ ...d, saleCostsNzd: moneyIn(e.target.value) })}
              />
            </label>
            {ownHome ? null : (
              <label className="rental-money-toggle">
                <span>
                  <input type="checkbox" checked={d.mainHome} onChange={(e) => setD({ ...d, mainHome: e.target.checked })} /> It was my main home
                </span>
              </label>
            )}
          </>
        ) : null}
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions
        busy={busy}
        disabled={!d.name.trim() || (sold && !d.saleAgreementDate)}
        saveLabel="Save property"
        hint={!d.name.trim() ? 'Add a name' : sold && !d.saleAgreementDate ? 'Add the sale agreement date' : null}
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

function EntryForm({ title, initial, properties, rooms, moneyViewsFrom, onSave, onClose }: {
  title: string;
  initial: EntryDraftForm;
  properties: RentalProperty[];
  rooms: RentalRoom[];
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

  const property = properties.find((p) => p.id === d.propertyId);
  const byRoom = property?.letType === 'rooms';
  const propertyRooms = rooms.filter((r) => r.propertyId === d.propertyId);

  function setKind(kind: RentalEntryKind) {
    setD((prev) => (prev.kind === kind ? prev : { ...prev, kind, category: RENTAL_CATEGORIES[kind][0].value, roomId: null, shared: false }));
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
          <select value={d.propertyId} onChange={(e) => setD((prev) => ({ ...prev, propertyId: e.target.value, roomId: null, shared: false }))}>
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
        {byRoom && d.kind === 'income' && propertyRooms.length > 0 ? (
          <label className="span-2">
            Room
            <select value={d.roomId ?? ''} onChange={(e) => set('roomId', e.target.value || null)}>
              <option value="">Whole property (no room)</option>
              {propertyRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {byRoom && d.kind === 'expense' ? (
          <label className="span-2 rental-money-toggle">
            <span>
              <input type="checkbox" checked={d.shared} onChange={(e) => set('shared', e.target.checked)} /> Share across the rooms
            </span>
            <span className="muted small">
              {d.shared ? 'Split across the rooms by each room’s share, e.g. power or internet.' : 'Kept as an owner cost, e.g. rates or insurance.'}
            </span>
          </label>
        ) : null}
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

const signedNzd = (n: number) => (n < 0 ? `−${formatNzd(-n)}` : formatNzd(n));

function TaxSummary({ tax, hasOwnHome, busy, onBasis }: { tax: RentalTaxYear; hasOwnHome: boolean; busy: boolean; onBasis: (b: LossBasis) => void }) {
  const basisLabel = useId();
  return (
    <div className="rental-tax">
      <p className="muted small rental-summary-label">For your tax return (estimate)</p>
      <dl className="rental-totals">
        <div>
          <dt>Interest you can deduct</dt>
          <dd>{formatNzd(tax.deductibleInterest)}</dd>
          {tax.deductibleInterest < tax.interest ? <dd className="muted small">of {formatNzd(tax.interest)} paid</dd> : null}
        </div>
        <div>
          <dt>Net for tax</dt>
          <dd className={tax.net < 0 ? 'rental-net--loss' : undefined}>{signedNzd(tax.net)}</dd>
        </div>
        <div>
          <dt>Loss from earlier years</dt>
          <dd>{formatNzd(tax.broughtForward)}</dd>
        </div>
        <div>
          <dt>Taxable rental income</dt>
          <dd>{formatNzd(tax.taxable)}</dd>
        </div>
        <div>
          <dt>Loss to carry forward</dt>
          <dd>{formatNzd(tax.carriedForward)}</dd>
        </div>
      </dl>
      <div className="warranty-field">
        <span id={basisLabel} className="warranty-field-label">
          Carry losses forward across
        </span>
        <RadioChips labelId={basisLabel} small options={BASIS_OPTIONS} value={tax.basis} onChange={(v) => (busy ? undefined : onBasis(v as LossBasis))} />
      </div>
      <p className="muted small">
        {tax.interestShare < 1 ? `In ${taxYearLabel(tax.endYear)} only ${Math.round(tax.interestShare * 100)}% of mortgage interest is deductible (new builds and your own home excepted). ` : ''}
        {tax.interestNote ? `${tax.interestNote} ` : ''}A rental loss can’t reduce your salary or other income: it carries forward to later rental profit.
        {hasOwnHome ? ` Your own home with boarders isn’t ring-fenced, so it’s left out of these figures (net ${signedNzd(tax.outsideNet)}).` : ''} Losses from
        before your first entry here aren’t known. See IRD:{' '}
        <a href={IRD_INTEREST_URL} target="_blank" rel="noreferrer">property interest rules</a> ·{' '}
        <a href={IRD_RING_FENCING_URL} target="_blank" rel="noreferrer">residential rental property deductions</a>.
      </p>
    </div>
  );
}

function propertyTaxNote(t: PropertyTaxYear | undefined, basis: LossBasis): string | null {
  if (!t || (t.income === 0 && t.expenses === 0 && !t.broughtForward)) return null;
  const parts = [`Net for tax ${signedNzd(t.net)}`];
  if (t.deductibleInterest < t.interest) parts.push(`interest counted ${formatNzd(t.deductibleInterest)} of ${formatNzd(t.interest)}`);
  if (!t.ringFenced) parts.push('not ring-fenced');
  else if (basis === 'property') {
    if (t.broughtForward) parts.push(`loss from earlier years ${formatNzd(t.broughtForward)}`);
    parts.push(`taxable ${formatNzd(t.taxable ?? 0)}`);
    if (t.carriedForward) parts.push(`loss to carry forward ${formatNzd(t.carriedForward)}`);
  }
  return parts.join(' · ');
}

function BrightLineNote({ property }: { property: RentalProperty }) {
  const b = brightLine({ ...property, mainHome: property.ownHome || property.mainHome });
  if (!b) return null;
  const link = (
    <a href={IRD_BRIGHT_LINE_URL} target="_blank" rel="noreferrer">
      IRD: the bright-line test
    </a>
  );
  let text: string;
  if (b.status === 'main_home') text = 'Your main home, so the bright-line test generally doesn’t apply.';
  else if (b.status === 'older_rules') text = 'Sale agreed before 1 July 2024, when longer bright-line periods (2, 5 or 10 years) applied. Not worked out here.';
  else if (b.status === 'incomplete') text = 'Add the date the purchase settled to check the bright-line test.';
  else if (b.status === 'outside')
    text = `Outside the 2-year bright-line (it ended ${longDate(b.endsOn!)}). A sale can still be taxable if you bought to sell or deal in property.`;
  else
    text =
      `Inside the 2-year bright-line (it runs to ${longDate(b.endsOn!)}), so the gain is taxable. ` +
      (b.gainNzd == null
        ? 'Add the cost and sale price to estimate it.'
        : `Estimated taxable gain ${signedNzd(b.gainNzd)} (sale price − cost − selling costs)${b.gainNzd < 0 ? '; a loss can generally only be used against other taxable land sales' : ''}.`);
  return (
    <p className={'small' + (b.status === 'inside' ? ' hh-over' : ' muted')}>
      {text} Estimate, not tax advice. {link}.
    </p>
  );
}

function moneyNote(e: RentalEntry, moneyViewsFrom: string): string {
  if (e.bankMatch) return `In Budget · matched to ${e.bankMatch.description || 'bank payment'} on ${longDate(e.bankMatch.date)}`;
  if (e.inMoneyViews) return e.kind === 'income' ? 'In Income' : 'In Budget';
  if (!e.addToMoney) return 'Not in Budget';
  if (e.date < moneyViewsFrom) return 'Before Budget starts';
  return 'Removed from Budget · save to add back';
}

function PropertyCard({ property, entries, rooms, tenancies, year, today, tax, roomActions, moneyViewsFrom, busy, onAdd, onEditEntry, onDeleteEntry, onEdit, onDelete }: {
  property: RentalProperty;
  tax: RentalTaxYear;
  entries: RentalEntry[];
  rooms: RentalRoom[];
  tenancies: RentalTenancy[];
  year: number;
  today: string;
  roomActions: RoomActions;
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
  const roomName = (id: string | null) => (id ? rooms.find((r) => r.id === id)?.name ?? null : null);
  return (
    <article className="panel warranty-card rental-card" aria-labelledby={`rental-${property.id}`}>
      <div className="rental-card-head">
        <div className="warranty-card-title">
          <h4 id={`rental-${property.id}`}>{property.name}</h4>
          {property.address ? <p className="warranty-card-sub">{property.address}</p> : null}
          {property.letType === 'rooms' ? (
            <p className="warranty-card-sub">{property.ownHome ? 'Your home · rooms let' : 'Let room by room'}</p>
          ) : null}
          {property.saleAgreementDate ? <p className="warranty-card-sub">Sold · agreement {longDate(property.saleAgreementDate)}</p> : null}
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
      {propertyTaxNote(tax.properties[property.id], tax.basis) ? <p className="muted small">{propertyTaxNote(tax.properties[property.id], tax.basis)}</p> : null}
      <BrightLineNote property={property} />
      {property.letType === 'rooms' ? (
        <RoomsPanel
          property={property}
          rooms={rooms}
          tenancies={tenancies}
          entries={entries}
          year={year}
          today={today}
          busy={busy}
          actions={roomActions}
        />
      ) : null}
      {rows.length === 0 ? (
        <p className="muted small">Nothing recorded in {taxYearLabel(year)}.</p>
      ) : (
        <ul className="rental-entries">
          {rows.map((e) => (
            <li key={e.id} className="rental-entry">
              <div className="rental-entry-what">
                <span>{e.description || rentalCategoryLabel(e.category)}</span>
                <span className="muted small">
                  {longDate(e.date)} · {rentalCategoryLabel(e.category)}
                  {roomName(e.roomId) ? ` · ${roomName(e.roomId)}` : ''}
                  {e.shared ? ' · shared' : ''} · {moneyNote(e, moneyViewsFrom)}
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

function newTenancy(roomId: string, today: string): RentalTenancyWriteBody {
  return {
    roomId,
    tenantLabel: '',
    rentAmount: 0,
    rentFrequency: 'weekly',
    billsIncluded: false,
    startDate: today,
    endDate: null,
    bondAmount: 0,
    bondLodged: false,
  };
}

function tenancyBody(t: RentalTenancy): RentalTenancyWriteBody {
  const { id: _id, createdAt: _c, updatedAt: _u, ...body } = t;
  return body;
}

type DialogState =
  | { mode: 'add-property' }
  | { mode: 'edit-property'; item: RentalProperty }
  | { mode: 'add-entry'; draft: EntryDraftForm }
  | { mode: 'edit-entry'; item: RentalEntry }
  | { mode: 'add-room'; propertyId: string }
  | { mode: 'edit-room'; item: RentalRoom }
  | { mode: 'add-tenancy'; room: RentalRoom }
  | { mode: 'edit-tenancy'; room: RentalRoom; item: RentalTenancy }
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
  const rooms = data?.rooms ?? [];
  const tenancies = data?.tenancies ?? [];
  const years = today ? rentalTaxYears(entries, today) : [];
  const shownYear = year ?? (today ? taxYearOf(today) : null);
  const yearIdx = shownYear == null ? -1 : years.indexOf(shownYear);
  const tax = shownYear == null ? null : rentalTaxYear(properties, entries, shownYear, data?.lossBasis ?? 'portfolio');

  function addEntry(kind: RentalEntryKind, propertyId = properties[0]?.id ?? '') {
    setDialog({
      mode: 'add-entry',
      draft: {
        propertyId,
        kind,
        category: RENTAL_CATEGORIES[kind][0].value,
        date: today,
        amount: '',
        description: '',
        addToMoney: true,
        roomId: null,
        shared: false,
      },
    });
  }

  const roomActions = (propertyId: string): RoomActions => ({
    onAddRoom: () => setDialog({ mode: 'add-room', propertyId }),
    onEditRoom: (room) => setDialog({ mode: 'edit-room', item: room }),
    onDeleteRoom: (room) =>
      void act(
        () => api.rentals.removeRoom(room.id),
        `${room.name} deleted.`,
        `Delete ${room.name} and its tenancies? Rent already recorded for it stays on the property.`,
      ),
    onAddTenancy: (room) => setDialog({ mode: 'add-tenancy', room }),
    onEditTenancy: (room, t) => setDialog({ mode: 'edit-tenancy', room, item: t }),
    onDeleteTenancy: (t) => void act(() => api.rentals.removeTenancy(t.id), 'Tenancy deleted.', `Delete ${t.tenantLabel}’s tenancy?`),
    onRecordRent: (room, t) =>
      setDialog({
        mode: 'add-entry',
        draft: {
          propertyId: room.propertyId,
          kind: 'income',
          category: 'rent',
          date: today,
          amount: t ? String(t.rentAmount) : '',
          description: t ? `Rent · ${t.tenantLabel}` : '',
          addToMoney: true,
          roomId: room.id,
          shared: false,
        },
      }),
  });

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

      {data && properties.length > 0 && shownYear != null && tax ? (
        <>
          <section className="panel rental-summary" aria-label={`All properties, ${taxYearLabel(shownYear)}`}>
            <p className="muted small rental-summary-label">
              All properties · 1 Apr {shownYear - 1} – 31 Mar {shownYear}
            </p>
            <Totals {...rentalTotals(entries, shownYear)} />
            <TaxSummary
              tax={tax}
              hasOwnHome={properties.some((p) => p.ownHome)}
              busy={busy}
              onBasis={(b) => void act(() => api.rentals.setLossBasis(b), b === 'portfolio' ? 'Losses now carry forward across all properties.' : 'Losses now carry forward property by property.')}
            />
          </section>
          <section className="warranty-card-list" aria-label="Properties">
            {properties.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                entries={entries}
                rooms={rooms}
                tenancies={tenancies}
                year={shownYear}
                today={today}
                tax={tax}
                roomActions={roomActions(p.id)}
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
                    `Delete ${p.name} and everything recorded for it${p.letType === 'rooms' ? ', including its rooms and tenancies' : ''}? Its rent and expenses are removed from Budget and Income too.`,
                  )
                }
              />
            ))}
          </section>
          <p className="warranties-cga">
            Totals run over the tax year, 1 April to 31 March. The tax figures are an estimate from what’s recorded here, so
            check them against IRD’s rules before filing your IR3R. General information, not tax advice.
          </p>
        </>
      ) : null}

      {dialog?.mode === 'add-property' ? (
        <PropertyForm
          title="Add property"
          initial={EMPTY_PROPERTY}
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
          initial={{
            name: dialog.item.name,
            address: dialog.item.address,
            notes: dialog.item.notes,
            letType: dialog.item.letType,
            ownHome: dialog.item.ownHome,
            newBuild: dialog.item.newBuild,
            purchaseDate: dialog.item.purchaseDate,
            purchaseCostNzd: dialog.item.purchaseCostNzd,
            saleAgreementDate: dialog.item.saleAgreementDate,
            salePriceNzd: dialog.item.salePriceNzd,
            saleCostsNzd: dialog.item.saleCostsNzd,
            mainHome: dialog.item.mainHome,
          }}
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
          rooms={rooms}
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
            roomId: dialog.item.roomId,
            shared: dialog.item.shared,
          }}
          properties={properties}
          rooms={rooms}
          moneyViewsFrom={data?.moneyViewsFrom ?? ''}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.rentals.updateEntry(dialog.item.id, body);
            await saved('Entry updated.');
          }}
        />
      ) : null}
      {dialog?.mode === 'add-room' ? (
        <RoomForm
          title={`Add a room to ${propertyName(dialog.propertyId)}`}
          initial={{ name: '', note: '', share: 1 }}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.rentals.createRoom({ ...body, propertyId: dialog.propertyId });
            await saved(`${body.name.trim()} added.`);
          }}
        />
      ) : null}
      {dialog?.mode === 'edit-room' ? (
        <RoomForm
          title={`Edit ${dialog.item.name}`}
          initial={{ name: dialog.item.name, note: dialog.item.note, share: dialog.item.share }}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.rentals.updateRoom(dialog.item.id, body);
            await saved(`${body.name.trim()} updated.`);
          }}
        />
      ) : null}
      {dialog?.mode === 'add-tenancy' ? (
        <TenancyForm
          title="Add tenancy"
          roomName={`${dialog.room.name} · ${propertyName(dialog.room.propertyId)}`}
          initial={newTenancy(dialog.room.id, today)}
          others={tenancies.filter((t) => t.roomId === dialog.room.id)}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.rentals.createTenancy(body);
            await saved(`${body.tenantLabel.trim()} added to ${dialog.room.name}.`);
          }}
        />
      ) : null}
      {dialog?.mode === 'edit-tenancy' ? (
        <TenancyForm
          title={`Edit ${dialog.item.tenantLabel}’s tenancy`}
          roomName={`${dialog.room.name} · ${propertyName(dialog.room.propertyId)}`}
          initial={tenancyBody(dialog.item)}
          others={tenancies.filter((t) => t.roomId === dialog.room.id && t.id !== dialog.item.id)}
          onClose={() => setDialog(null)}
          onSave={async ({ roomId: _room, ...body }) => {
            await api.rentals.updateTenancy(dialog.item.id, body);
            await saved('Tenancy updated.');
          }}
        />
      ) : null}
    </div>
  );
}
