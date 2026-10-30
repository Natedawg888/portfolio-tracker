/**
 * One business's suppliers and their bills (KAN-123). Bills show paid, unpaid or overdue; a paid
 * bill is an expense on the day it was paid (KAN-121). Each bill can carry its PDF or photo.
 * Freight on a goods bill either goes into the stock's cost (capitalise) or is its own expense.
 * A supplier with bills can't be deleted. Viewers see the lists only (KAN-129).
 */
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatNzd, type BillWriteBody, type SupplierWriteBody } from '../api/client';
import { BusinessTabs, Dialog, FormActions, errorText } from '../components/business/BusinessUi';
import { useBusinessInfo } from '../components/business/useBusinessInfo';
import { readFile } from '../components/warranties/receiptFile';
import { aucklandToday } from '../lib/debtModel';
import { showQuietToast } from '../lib/quietToast';
import type { BillStatus, Supplier, SupplierBill } from '../lib/suppliers';
import { formatInvoiceDate } from './invoicesView';

const STATUS_LABEL: Record<BillStatus, string> = { paid: 'Paid', unpaid: 'Unpaid', overdue: 'Overdue' };
type Filter = 'all' | BillStatus;

export function BusinessSuppliers() {
  const { id = '' } = useParams<{ id: string }>();
  const info = useBusinessInfo(id);
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [bills, setBills] = useState<SupplierBill[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ mode: 'supplier'; supplier: Supplier | null } | { mode: 'bill'; bill: SupplierBill | null } | null>(null);
  const [reload, setReload] = useState(0);
  const today = aucklandToday();

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.business.suppliers(id), api.business.bills(id)])
      .then(([s, b]) => {
        if (cancelled) return;
        setSuppliers(s);
        setBills(b);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e, 'Could not load suppliers.'));
      });
    return () => {
      cancelled = true;
    };
  }, [id, reload]);

  const shown = useMemo(
    () => (bills ?? []).filter((b) => (filter === 'all' || b.status === filter) && (!supplierFilter || b.supplierId === supplierFilter)),
    [bills, filter, supplierFilter],
  );
  const owed = (bills ?? []).filter((b) => b.status !== 'paid');
  const overdue = owed.filter((b) => b.status === 'overdue');

  async function act(fn: () => Promise<unknown>, note: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      showQuietToast(note);
      setReload((n) => n + 1);
    } catch (e) {
      setError(errorText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  async function upload(bill: SupplierBill, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await act(async () => api.business.uploadBillFile(bill.id, await readFile(file), file.name), 'File attached.');
  }

  return (
    <div className="stack bills-page warranties-page rentals-page business-page suppliers-page">
      <BusinessTabs />
      <header className="business-detail-header">
        <Link className="warranties-back" to={`/business/${encodeURIComponent(id)}`}>
          ‹ {info.name || 'Business'}
        </Link>
        <div className="business-detail-row">
          <div className="business-detail-name">
            <h2 className="page-title">Suppliers &amp; bills</h2>
          </div>
          {info.canEdit && suppliers ? (
            <div className="business-detail-actions">
              <button type="button" className="btn small" onClick={() => setDialog({ mode: 'supplier', supplier: null })}>
                + Supplier
              </button>
              <button type="button" className="btn small primary" disabled={!suppliers.length} onClick={() => setDialog({ mode: 'bill', bill: null })}>
                + Bill
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {error || info.error ? <p className="auth-error" role="alert">{error ?? info.error}</p> : null}

      <section className="panel rental-summary business-summary" aria-label="Bills">
        <dl className="rental-totals business-totals business-totals--three">
          <div>
            <dt>Suppliers</dt>
            <dd>{suppliers?.length ?? '—'}</dd>
          </div>
          <div>
            <dt>Owed</dt>
            <dd>{formatNzd(owed.reduce((s, b) => s + b.amountNzd, 0))}</dd>
          </div>
          <div>
            <dt>Overdue</dt>
            <dd className={overdue.length ? 'stock-needs' : undefined}>{overdue.length ? `${formatNzd(overdue.reduce((s, b) => s + b.amountNzd, 0))} (${overdue.length})` : 'None'}</dd>
          </div>
        </dl>
      </section>

      <section className="panel warranty-card" aria-labelledby="bills-title">
        <div className="rental-card-head">
          <h3 id="bills-title">Bills</h3>
          {bills?.length ? (
            <div className="stock-toolbar">
              <label>
                <span className="sr-only">Show</span>
                <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                  <option value="all">All bills</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="overdue">Overdue</option>
                  <option value="paid">Paid</option>
                </select>
              </label>
              <label>
                <span className="sr-only">Supplier</span>
                <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
                  <option value="">Every supplier</option>
                  {(suppliers ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
        {bills == null ? (
          error ? null : <p className="muted">Loading…</p>
        ) : bills.length === 0 ? (
          <p className="muted small">{suppliers?.length ? 'No bills yet. Add the bills your suppliers send, and mark them paid when you pay.' : 'Add a supplier first, then their bills.'}</p>
        ) : shown.length === 0 ? (
          <p className="muted small">No bills match.</p>
        ) : (
          <ul className="rental-entries">
            {shown.map((b) => (
              <li key={b.id} className="rental-entry">
                <div className="rental-entry-what">
                  <span>
                    {b.supplierName}
                    {b.reference ? <span className="muted"> · {b.reference}</span> : null}
                    {b.kind === 'delivery' ? <span className="muted small"> · Delivery</span> : null}
                  </span>
                  <span className="muted small">
                    Billed {formatInvoiceDate(b.invoiceDate)} ·{' '}
                    {b.paidOn ? `paid ${formatInvoiceDate(b.paidOn)}` : `due ${formatInvoiceDate(b.dueDate)}`}
                    {b.kind === 'stock' && b.deliveryNzd > 0 ? ` · ${formatNzd(b.deliveryNzd)} freight ${b.deliveryTreatment === 'capitalise' ? 'in stock cost' : 'as an expense'}` : ''}
                  </span>
                </div>
                <span className="rental-entry-amount rental-entry-amount--out">
                  {formatNzd(b.amountNzd)}
                  <span className={`bill-status bill-status--${b.status}`}>{STATUS_LABEL[b.status]}</span>
                </span>
                <span className="rental-entry-actions sale-actions">
                  {b.file ? (
                    <a href={b.file.url} target="_blank" rel="noreferrer" aria-label={`${b.supplierName} bill file: ${b.file.name}`}>
                      File
                    </a>
                  ) : null}
                  {info.canEdit ? (
                    <>
                      {!b.paidOn ? (
                        <button
                          type="button"
                          className="link-btn"
                          disabled={busy}
                          onClick={() => void act(() => api.business.updateBill(b.id, { ...billBody(b), paidOn: today }), `Marked paid today. ${formatNzd(b.amountNzd)} counts as a cost.`)}
                        >
                          Mark paid
                        </button>
                      ) : null}
                      <button type="button" className="link-btn" disabled={busy} onClick={() => setDialog({ mode: 'bill', bill: b })}>
                        Edit
                      </button>
                      {b.file ? null : (
                        <label className="link-btn sale-upload">
                          Attach file
                          <input type="file" className="sr-only" accept="application/pdf,image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={(e) => void upload(b, e)} />
                        </label>
                      )}
                      <button type="button" className="link-btn" disabled={busy} onClick={() => void act(() => api.business.removeBill(b.id), 'Bill deleted.', `Delete this ${formatNzd(b.amountNzd)} bill from ${b.supplierName}${b.file ? ' and its file' : ''}?`)}>
                        Delete
                      </button>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel warranty-card" aria-labelledby="suppliers-title">
        <div className="rental-card-head">
          <h3 id="suppliers-title">Suppliers</h3>
        </div>
        {suppliers == null ? null : suppliers.length === 0 ? (
          <p className="muted small">No suppliers yet. Add who you buy stock and services from, with their GST number so their bills can be claimed.</p>
        ) : (
          <ul className="rental-entries">
            {suppliers.map((s) => (
              <li key={s.id} className="rental-entry">
                <div className="rental-entry-what">
                  <span>{s.name}</span>
                  <span className="muted small">
                    {[s.contactPerson, s.email, s.phone].filter(Boolean).join(' · ') || 'No contact details'}
                    {s.gstNumber ? ` · GST ${s.gstNumber}` : ' · No GST number'}
                  </span>
                </div>
                <span className="rental-entry-amount rental-entry-amount--out">
                  {s.billCount} bill{s.billCount === 1 ? '' : 's'}
                  {s.unpaidNzd > 0 ? <span className="muted small"> · {formatNzd(s.unpaidNzd)} owed</span> : null}
                </span>
                <span className="rental-entry-actions">
                  {info.canEdit ? (
                    <>
                      <button type="button" className="link-btn" disabled={busy} onClick={() => setDialog({ mode: 'supplier', supplier: s })}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        disabled={busy || s.billCount > 0}
                        title={s.billCount > 0 ? 'Has bills: delete them first' : undefined}
                        onClick={() => void act(() => api.business.removeSupplier(s.id), `${s.name} deleted.`, `Delete ${s.name}?`)}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog?.mode === 'supplier' ? (
        <SupplierForm
          businessId={id}
          supplier={dialog.supplier}
          onClose={() => setDialog(null)}
          onSaved={(note) => {
            setDialog(null);
            showQuietToast(note);
            setReload((n) => n + 1);
          }}
        />
      ) : null}
      {dialog?.mode === 'bill' && suppliers ? (
        <BillForm
          businessId={id}
          bill={dialog.bill}
          suppliers={suppliers}
          today={today}
          onClose={() => setDialog(null)}
          onSaved={(note) => {
            setDialog(null);
            showQuietToast(note);
            setReload((n) => n + 1);
          }}
        />
      ) : null}
      <p className="muted small business-foot">A bill counts as a cost on the day it’s paid. Unpaid bills show here until then.</p>
    </div>
  );
}

function billBody(b: SupplierBill): BillWriteBody {
  return {
    supplierId: b.supplierId,
    kind: b.kind,
    reference: b.reference,
    invoiceDate: b.invoiceDate,
    dueDate: b.dueDate,
    amountNzd: b.amountNzd,
    deliveryNzd: b.deliveryNzd,
    deliveryTreatment: b.deliveryTreatment,
    paidOn: b.paidOn,
    transactionId: b.transactionId,
    notes: b.notes,
  };
}

function SupplierForm({ businessId, supplier, onClose, onSaved }: { businessId: string; supplier: Supplier | null; onClose: () => void; onSaved: (note: string) => void }) {
  const [d, setD] = useState<SupplierWriteBody>(() => ({
    name: supplier?.name ?? '',
    contactPerson: supplier?.contactPerson ?? '',
    email: supplier?.email ?? '',
    phone: supplier?.phone ?? '',
    address: supplier?.address ?? '',
    nzbn: supplier?.nzbn ?? '',
    gstNumber: supplier?.gstNumber ?? '',
    notes: supplier?.notes ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof SupplierWriteBody, label: string, type = 'text') => (
    <label>
      {label}
      <input type={type} value={d[key]} onChange={(e) => setD({ ...d, [key]: e.target.value })} />
    </label>
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (supplier) await api.business.updateSupplier(supplier.id, d);
      else await api.business.createSupplier(businessId, d);
      onSaved(`${d.name.trim()} saved.`);
    } catch (e) {
      setError(errorText(e, 'Could not save the supplier.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={supplier ? `Edit ${supplier.name}` : 'Add supplier'} onClose={onClose}>
      <div className="form-grid warranty-form">
        {field('name', 'Name')}
        {field('contactPerson', 'Contact person')}
        {field('email', 'Email', 'email')}
        {field('phone', 'Phone', 'tel')}
        {field('address', 'Address')}
        {field('nzbn', 'NZBN')}
        {field('gstNumber', 'GST number')}
        <label>
          Notes
          <textarea rows={2} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={d.name.trim() ? null : 'Add a name'} saveLabel={busy ? 'Saving…' : 'Save supplier'} onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}

function BillForm({ businessId, bill, suppliers, today, onClose, onSaved }: {
  businessId: string;
  bill: SupplierBill | null;
  suppliers: Supplier[];
  today: string;
  onClose: () => void;
  onSaved: (note: string) => void;
}) {
  const [d, setD] = useState(() => ({
    supplierId: bill?.supplierId ?? suppliers[0]?.id ?? '',
    kind: bill?.kind ?? ('stock' as const),
    reference: bill?.reference ?? '',
    invoiceDate: bill?.invoiceDate ?? today,
    dueDate: bill?.dueDate ?? today,
    amount: bill ? String(bill.amountNzd) : '',
    delivery: bill && bill.kind === 'stock' && bill.deliveryNzd ? String(bill.deliveryNzd) : '',
    deliveryTreatment: bill?.deliveryTreatment ?? ('capitalise' as const),
    paid: bill?.paidOn != null,
    paidOn: bill?.paidOn ?? today,
    notes: bill?.notes ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = Number(d.amount);
  const delivery = d.kind === 'delivery' ? amount : d.delivery.trim() ? Number(d.delivery) : 0;
  const hint = !d.supplierId
    ? 'Pick a supplier'
    : !d.amount.trim() || !Number.isFinite(amount) || amount < 0
      ? 'Enter the bill’s amount'
      : !Number.isFinite(delivery) || delivery < 0 || delivery > amount
        ? 'Freight must be from 0 up to the bill’s amount'
        : !d.invoiceDate || !d.dueDate
          ? 'Add the bill and due dates'
          : d.paid && (!d.paidOn || d.paidOn > today)
            ? 'The paid date can’t be in the future'
            : null;

  async function save() {
    if (hint) return;
    setBusy(true);
    setError(null);
    const body: BillWriteBody = {
      supplierId: d.supplierId,
      kind: d.kind,
      reference: d.reference.trim(),
      invoiceDate: d.invoiceDate,
      dueDate: d.dueDate,
      amountNzd: amount,
      deliveryNzd: delivery,
      deliveryTreatment: d.deliveryTreatment,
      paidOn: d.paid ? d.paidOn : null,
      // Unpaid bills can't keep a bank payment link.
      transactionId: d.paid ? (bill?.transactionId ?? null) : null,
      notes: d.notes.trim(),
    };
    try {
      if (bill) await api.business.updateBill(bill.id, body);
      else await api.business.createBill(businessId, body);
      onSaved('Bill saved.');
    } catch (e) {
      setError(errorText(e, 'Could not save the bill.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={bill ? 'Edit bill' : 'Add bill'} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label>
          Supplier
          <select value={d.supplierId} onChange={(e) => setD({ ...d, supplierId: e.target.value })}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          What it’s for
          <select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value === 'delivery' ? 'delivery' : 'stock' })}>
            <option value="stock">Goods or stock</option>
            <option value="delivery">Delivery only</option>
          </select>
        </label>
        <label>
          Their invoice number
          <input value={d.reference} maxLength={80} onChange={(e) => setD({ ...d, reference: e.target.value })} />
        </label>
        <label>
          Amount (NZD)
          <input inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} />
        </label>
        {d.kind === 'stock' ? (
          <>
            <label>
              Of which freight (optional)
              <input inputMode="decimal" value={d.delivery} placeholder="0" onChange={(e) => setD({ ...d, delivery: e.target.value })} />
            </label>
            {delivery > 0 ? (
              <label>
                Freight
                <select value={d.deliveryTreatment} onChange={(e) => setD({ ...d, deliveryTreatment: e.target.value === 'expense' ? 'expense' : 'capitalise' })}>
                  <option value="capitalise">Add to the stock’s cost</option>
                  <option value="expense">Count as its own expense</option>
                </select>
              </label>
            ) : null}
          </>
        ) : null}
        <label>
          Bill date
          <input type="date" value={d.invoiceDate} onChange={(e) => setD({ ...d, invoiceDate: e.target.value })} />
        </label>
        <label>
          Due
          <input type="date" value={d.dueDate} onChange={(e) => setD({ ...d, dueDate: e.target.value })} />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={d.paid} onChange={(e) => setD({ ...d, paid: e.target.checked })} />
          Paid
        </label>
        {d.paid ? (
          <label>
            Paid on
            <input type="date" value={d.paidOn} max={today} onChange={(e) => setD({ ...d, paidOn: e.target.value })} />
          </label>
        ) : null}
        <label>
          Notes
          <textarea rows={2} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel={busy ? 'Saving…' : 'Save bill'} onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}
