/**
 * New / edit draft invoice (KAN-71). Phase 2 builder: bill-to chips, line items,
 * one-tap due dates, and a GST checkbox, with a live preview beside the form.
 * Phase 4: "Client withholds tax" writes the existing withholdingRatePct.
 * The percent is prefilled only from an IR330C activity in the browser prefs.
 * Totals use editorInvoiceTotals (invoiceTotals). The server recomputes them on save.
 * You'll receive is amountDue from that result. Mark as sent still goes through
 * the existing mark-sent action, which rejects with sendProblem when the invoice
 * is not ready to send.
 * Each invoice belongs to a business (KAN-84). With more than one, a picker chooses which;
 * ?business=<id> preselects it, and saved clients are that business's.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, formatNzd, type InvoiceWriteBody } from '../api/client';
import { InfoTip } from '../components/InfoTip';
import { InvoicePreview } from '../components/InvoicePreview';
import {
  INVOICE_UNIT_PRESETS,
  type DuePreset,
  type GstMode,
} from '../lib/invoiceCalc';
import { payTaxYearRates } from '../lib/payeRates';
import { loadOutputPayPrefs } from '../lib/outputPayPrefs';
import type { Business, BusinessProfile, InvoiceClient, PaySource, PublicInvoice } from '../types';
import {
  BUSINESS_SETTINGS_HREF,
  DUE_TAP_PRESETS,
  INVOICE_MISSING,
  businessPromptLead,
  editorDueDate,
  editorGstMode,
  editorInvoiceTotals,
  editorReceiveAmount,
  editorWithholdingPrefill,
  formatInvoiceDate,
  gstEditorControl,
  gstModeFromCheckbox,
  invoiceActionBlock,
} from './invoicesView';

type LineDraft = { key: string; description: string; quantity: string; unit: string; rate: string };

const GST_PRESERVED: { value: GstMode; label: string }[] = [
  { value: 'exclusive', label: 'GST 15% on top' },
  { value: 'inclusive', label: 'Prices include GST' },
  { value: 'none', label: 'No GST' },
];

function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function blankLine(): LineDraft {
  return { key: newKey(), description: '', quantity: '1', unit: 'hour', rate: '' };
}

function todayNz(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function num(text: string): number {
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

/** What an invoice prints for a business. */
function profileOf(b: Business): BusinessProfile {
  return {
    businessName: b.name,
    address: b.address,
    email: b.email,
    phone: b.phone,
    bankAccount: b.bankAccount,
    gstRegistered: b.gstRegistered,
    gstNumber: b.gstNumber,
    nzbn: b.nzbn,
    invoicePrefix: b.invoicePrefix,
  };
}

function keptDueLabel(preset: DuePreset): string | null {
  if (preset === 'on_receipt') return 'On receipt';
  if (preset === 'days_30') return '30 days';
  return null;
}

const UNIT_OPTIONS = [...new Set(INVOICE_UNIT_PRESETS.flatMap((g) => [...g.units]))];

const MARK_SENT_CONFIRM = 'Mark as sent without sending from here? You won’t be able to edit it after this.';

export function InvoiceEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const wantedBusiness = searchParams.get('business');
  const editingId = id ?? null;
  const navError = (location.state as { sendError?: string } | null)?.sendError ?? null;
  const actionReasonId = useId();
  const withholdingHintId = useId();

  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [clients, setClients] = useState<InvoiceClient[]>([]);
  const [contractSources, setContractSources] = useState<PaySource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const [number, setNumber] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientReference, setClientReference] = useState('');
  const [clientExtraOpen, setClientExtraOpen] = useState(false);
  const [issueDate, setIssueDate] = useState(todayNz());
  const [duePreset, setDuePreset] = useState<DuePreset>('days_14');
  const [customDue, setCustomDue] = useState('');
  const [reference, setReference] = useState('');
  const [gstMode, setGstMode] = useState<GstMode>('none');
  const [inclusiveDraft, setInclusiveDraft] = useState(false);
  const [withholdingOn, setWithholdingOn] = useState(false);
  const [withholdingPct, setWithholdingPct] = useState('');
  const [prefillRate, setPrefillRate] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fallback, cl, owned, sources] = await Promise.all([
          api.invoices.business(),
          api.invoices.clients(),
          api.business.list().then((r) => r.businesses).catch(() => [] as Business[]),
          api.paySources.list().catch(() => [] as PaySource[]),
        ]);
        if (cancelled) return;
        // A new invoice goes to ?business=, else the default business (none yet → made on save).
        const inv = editingId ? await api.invoices.get(editingId) : null;
        if (cancelled) return;
        // A draft of an archived business (not in the picker) keeps its business and its details.
        const archivedOwner = inv?.businessId && !owned.some((b) => b.id === inv.businessId) ? inv.businessId : null;
        const chosen = archivedOwner
          ? null
          : (owned.find((b) => b.id === (inv?.businessId ?? wantedBusiness)) ?? owned.find((b) => b.isDefault) ?? owned[0] ?? null);
        const biz = archivedOwner && inv ? inv.business : chosen ? profileOf(chosen) : fallback;
        const list = inv ? null : await api.invoices.list(chosen ? { businessId: chosen.id } : {});
        if (cancelled) return;
        setBusinesses(archivedOwner ? [] : owned);
        setBusinessId(archivedOwner ?? chosen?.id ?? '');
        setBusiness(biz);
        setClients(cl);
        setContractSources(sources.filter((s) => s.inputs?.payType === 'schedular'));
        if (list) setNumber(list.nextNumber);
        const prefill = editorWithholdingPrefill(loadOutputPayPrefs(), payTaxYearRates());
        setPrefillRate(prefill.ratePct);
        if (inv) {
          if (inv.storedStatus !== 'draft') {
            navigate(`/business/invoices/${inv.id}`, { replace: true });
            return;
          }
          setNumber(inv.number);
          setClientId(inv.clientId ?? '');
          setClientName(inv.clientName);
          setClientEmail(inv.clientEmail);
          setClientAddress(inv.clientAddress);
          setClientReference(inv.clientReference);
          setClientExtraOpen(Boolean(inv.clientEmail.trim() || inv.clientAddress.trim() || inv.clientReference.trim()));
          setIssueDate(inv.issueDate);
          setDuePreset(inv.duePreset);
          setCustomDue(inv.duePreset === 'custom' ? inv.dueDate : '');
          setReference(inv.reference);
          setGstMode(inv.gstMode);
          setInclusiveDraft(inv.gstMode === 'inclusive');
          setWithholdingOn(inv.withholdingRatePct != null);
          setWithholdingPct(inv.withholdingRatePct != null ? String(inv.withholdingRatePct) : '');
          setNotes(inv.notes);
          setPaymentInstructions(inv.paymentInstructions);
          setNotesOpen(Boolean(inv.notes.trim() || inv.paymentInstructions.trim()));
          setLines(
            inv.lines.length > 0
              ? inv.lines.map((l) => ({ key: newKey(), description: l.description, quantity: String(l.quantity), unit: l.unit, rate: String(l.rate) }))
              : [blankLine()],
          );
        } else {
          if (biz.gstRegistered) setGstMode('exclusive');
          if (prefill.on && prefill.ratePct != null) {
            setWithholdingOn(true);
            setWithholdingPct(String(prefill.ratePct));
          }
        }
        setLoaded(true);
        if (navError) setError(navError);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the invoice.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editingId, navigate, navError, wantedBusiness]);

  /** Another business: its details and GST, its clients, and (for a new invoice) its next number. */
  function chooseBusiness(nextId: string) {
    const b = businesses.find((x) => x.id === nextId);
    if (!b) return;
    setBusinessId(b.id);
    setBusiness(profileOf(b));
    if (clientId && clients.find((c) => c.id === clientId)?.businessId !== b.id) setClientId('');
    if (!editingId) {
      setGstMode(b.gstRegistered ? 'exclusive' : 'none');
      setInclusiveDraft(false);
      api.invoices
        .list({ businessId: b.id })
        .then((l) => setNumber(l.nextNumber))
        .catch(() => undefined);
    }
  }

  const businessClients = clients.filter((c) => !businessId || !c.businessId || c.businessId === businessId);

  function applyClient(c: InvoiceClient) {
    setClientId(c.id);
    setClientName(c.name);
    setClientEmail(c.email);
    setClientAddress(c.address);
    setClientReference(c.reference);
    if (c.email.trim() || c.address.trim() || c.reference.trim()) setClientExtraOpen(true);
  }

  function onNameChange(value: string) {
    setClientName(value);
    const selected = businessClients.find((c) => c.id === clientId);
    if (selected && selected.name !== value) setClientId('');
  }

  const gstRegistered = business ? business.gstRegistered : null;
  const effectiveGst = editorGstMode(gstRegistered, gstMode);
  const gstControl = gstEditorControl({ gstRegistered, gstMode, inclusiveDraft });
  const wt = withholdingOn && withholdingPct.trim() !== '' ? num(withholdingPct) : null;
  const dueDate = editorDueDate(issueDate, duePreset, customDue);
  const keptDue = keptDueLabel(duePreset);

  const lineInputs = useMemo(
    () => lines.map((l) => ({ description: l.description, quantity: num(l.quantity), unit: l.unit, rate: num(l.rate) })),
    [lines],
  );
  const totals = useMemo(
    () => editorInvoiceTotals(lineInputs, effectiveGst, wt),
    [lineInputs, effectiveGst, wt],
  );
  const actionBlock = invoiceActionBlock({ clientName, subtotal: totals.subtotal });
  const receive = editorReceiveAmount(totals);

  function onWithholdingChange(checked: boolean) {
    setWithholdingOn(checked);
    if (checked && withholdingPct.trim() === '' && prefillRate != null) {
      setWithholdingPct(String(prefillRate));
    }
  }

  const preview: PublicInvoice | null = useMemo(() => {
    if (!business) return null;
    return {
      number,
      title: business.gstRegistered && effectiveGst !== 'none' ? 'Tax invoice' : 'Invoice',
      status: 'draft',
      business,
      clientName,
      clientEmail,
      clientAddress,
      clientReference,
      issueDate,
      dueDate,
      reference,
      gstMode: effectiveGst,
      lines: lineInputs.map((l, i) => ({ id: lines[i].key, ...l, lineTotalNzd: totals.lineTotals[i] })),
      subtotalNzd: totals.subtotal,
      gstNzd: totals.gst,
      totalNzd: totals.total,
      withholdingRatePct: totals.withholdingRatePct || null,
      withholdingNzd: totals.withholding,
      amountDueNzd: totals.amountDue,
      paidNzd: 0,
      balanceNzd: totals.amountDue,
      notes,
      paymentInstructions,
    };
  }, [business, lineInputs, lines, totals, effectiveGst, number, clientName, clientEmail, clientAddress, clientReference, issueDate, dueDate, reference, notes, paymentInstructions]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function moveLine(index: number, delta: number) {
    setLines((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addFromSource(sourceId: string) {
    const src = contractSources.find((s) => s.id === sourceId);
    if (!src || src.inputs?.payType !== 'schedular') return;
    const { schedular, unit } = src.inputs;
    setLines((prev) => [
      ...prev.filter((l) => l.description.trim() || num(l.rate) !== 0),
      { key: newKey(), description: src.name, quantity: String(schedular.unitsPerWeek), unit, rate: String(schedular.ratePerUnit) },
    ]);
    if (schedular.withholdingRatePct > 0 && !withholdingOn) {
      setWithholdingOn(true);
      setWithholdingPct(String(schedular.withholdingRatePct));
    }
  }

  function writeBody(cid: string | null): InvoiceWriteBody {
    return {
      businessId: businessId || null,
      number: number.trim() || undefined,
      clientId: cid,
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim(),
      clientAddress: clientAddress.trim(),
      clientReference: clientReference.trim(),
      issueDate,
      duePreset,
      dueDate: duePreset === 'custom' ? customDue || null : null,
      reference,
      gstMode: effectiveGst,
      withholdingRatePct: wt,
      notes,
      paymentInstructions,
      lines: lines.map((l) => ({ description: l.description, quantity: num(l.quantity), unit: l.unit, rate: num(l.rate) })),
    };
  }

  async function persist(): Promise<{ id: string }> {
    let cid: string | null = clientId || null;
    const trimmedName = clientName.trim();
    if (!cid && trimmedName) {
      const existing = businessClients.find((c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase());
      if (existing) {
        cid = existing.id;
        setClientId(existing.id);
      } else {
        const created = await api.invoices.createClient({
          businessId: businessId || null,
          name: trimmedName,
          email: clientEmail.trim(),
          address: clientAddress.trim(),
          reference: clientReference.trim(),
        });
        cid = created.id;
        setClients((prev) => [...prev, created]);
        setClientId(created.id);
      }
    }
    const id = savedId ?? editingId;
    const saved = id ? await api.invoices.update(id, writeBody(cid)) : await api.invoices.create(writeBody(cid));
    setSavedId(saved.id);
    if (!number.trim()) setNumber(saved.number);
    return saved;
  }

  async function save() {
    if (actionBlock) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await persist();
      navigate(`/business/invoices/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the invoice.');
      setBusy(false);
    }
  }

  async function markSent() {
    if (actionBlock) return;
    if (!window.confirm(MARK_SENT_CONFIRM)) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await persist();
      try {
        await api.invoices.action(saved.id, 'mark-sent');
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not mark the invoice as sent.';
        setError(message);
        setBusy(false);
        if (!editingId) {
          navigate(`/business/invoices/${saved.id}/edit`, { replace: true, state: { sendError: message } });
        }
        return;
      }
      navigate(`/business/invoices/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the invoice.');
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <section className="panel invoices-page">
        {error ? <p className="auth-error" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </section>
    );
  }

  const promptLead = businessPromptLead(business);
  const actionsDisabled = busy || actionBlock != null;

  return (
    <div className="stack invoices-page invoice-editor">
      <section className="panel">
        <div className="panel-heading">
          <h2 className="page-title">{editingId ? `Edit ${number}` : 'New invoice'}</h2>
          <Link to={editingId ? `/business/invoices/${editingId}` : '/business/invoices'} className="btn small">
            Cancel
          </Link>
        </div>
      </section>

      <div className="invoice-editor-layout">
        <div className="stack">
          <section className="panel">
            <div className="form-grid">
              {businesses.length > 1 ? (
                <label className="span-2">
                  Business
                  <select value={businessId} onChange={(e) => chooseBusiness(e.target.value)}>
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name || 'Unnamed business'}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="span-2 invoice-bill-to">
                Bill to
                <input value={clientName} maxLength={120} onChange={(e) => onNameChange(e.target.value)} />
              </label>
            </div>
            {businessClients.length > 0 ? (
              <div className="invoice-client-block">
                <span className="invoice-field-label" id="invoice-saved-clients">Saved clients</span>
                <div className="invoice-client-chips" role="group" aria-labelledby="invoice-saved-clients">
                  {businessClients.filter((c) => c.status !== 'inactive' || c.id === clientId).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="invoice-client-chip"
                      aria-pressed={clientId === c.id}
                      onClick={() => applyClient(c)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <details
              className="invoice-more"
              open={clientExtraOpen}
              onToggle={(e) => setClientExtraOpen(e.currentTarget.open)}
            >
              <summary>Email and address</summary>
              <div className="form-grid">
                <label>
                  Email
                  <input type="email" value={clientEmail} maxLength={254} onChange={(e) => setClientEmail(e.target.value)} />
                </label>
                <label>
                  Reference
                  <input value={clientReference} maxLength={80} onChange={(e) => setClientReference(e.target.value)} />
                </label>
                <label className="span-2">
                  Address
                  <textarea rows={2} value={clientAddress} maxLength={400} onChange={(e) => setClientAddress(e.target.value)} />
                </label>
              </div>
            </details>

            <h3>Lines</h3>
            {contractSources.length > 0 ? (
              <label className="invoice-contract-source">
                Add a line from a saved contract calculation (PAYE page)
                <select value="" onChange={(e) => addFromSource(e.target.value)}>
                  <option value="">Choose…</option>
                  {contractSources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <datalist id="invoice-units">
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            {lines.map((l, i) => (
              <div key={l.key} className="invoice-line-row">
                <label className="invoice-line-desc">
                  Description
                  <input value={l.description} maxLength={500} onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                </label>
                <label>
                  Qty
                  <input type="number" step="any" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                </label>
                <label>
                  Rate
                  <input type="number" step="any" inputMode="decimal" value={l.rate} onChange={(e) => updateLine(l.key, { rate: e.target.value })} />
                </label>
                <div className="invoice-line-amount">
                  <span className="invoice-line-label">Amount</span>
                  <span className="invoice-line-amount-value">{formatNzd(totals.lineTotals[i] ?? 0)}</span>
                </div>
                <div className="invoice-line-actions">
                  <button type="button" className="btn small" aria-label="Move line up" disabled={i === 0} onClick={() => moveLine(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="btn small" aria-label="Move line down" disabled={i === lines.length - 1} onClick={() => moveLine(i, 1)}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={() => setLines((prev) => (prev.length === 1 ? [blankLine()] : prev.filter((x) => x.key !== l.key)))}
                  >
                    Remove
                  </button>
                </div>
                <label className="invoice-line-unit">
                  Unit
                  <input list="invoice-units" value={l.unit} maxLength={40} onChange={(e) => updateLine(l.key, { unit: e.target.value })} />
                </label>
              </div>
            ))}
            <button type="button" className="btn small invoice-add-line" onClick={() => setLines((prev) => [...prev, blankLine()])}>
              + Add line
            </button>

            <h3>Due</h3>
            <div className="form-grid">
              <label>
                Issue date
                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </label>
              <label>
                Invoice number
                <input value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} />
              </label>
              <label className="span-2">
                Reference
                <input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
              </label>
            </div>
            <fieldset className="invoice-choice">
              <legend>Due date</legend>
              <div className="invoice-choice-row" role="radiogroup" aria-label="Due date">
                {DUE_TAP_PRESETS.map((preset) => {
                  const active = duePreset === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className="invoice-choice-btn"
                      onClick={() => setDuePreset(preset.value)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {duePreset === 'custom' ? (
                <label className="invoice-custom-due">
                  Due date
                  <input type="date" value={customDue} min={issueDate} onChange={(e) => setCustomDue(e.target.value)} />
                </label>
              ) : null}
              <p className="muted small invoice-due-note">
                {keptDue ? `Saved choice: ${keptDue}. ` : null}
                Due {formatInvoiceDate(dueDate)}
              </p>
            </fieldset>

            {gstControl.kind === 'checkbox' ? (
              <div className="invoice-gst-row">
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={gstControl.checked}
                    onChange={(e) => setGstMode(gstModeFromCheckbox(e.target.checked))}
                  />
                  GST 15%
                </label>
                <InfoTip label="About GST 15%">
                  Tick to add 15% on top of the line amounts. Leave it off to charge no GST on this invoice.
                </InfoTip>
              </div>
            ) : null}
            {gstControl.kind === 'preserved' ? (
              <div className="invoice-gst-row">
                <fieldset className="invoice-choice">
                  <legend>GST</legend>
                  <div className="invoice-choice-row" role="radiogroup" aria-label="GST">
                    {GST_PRESERVED.map((choice) => {
                      const active = gstControl.mode === choice.value;
                      return (
                        <button
                          key={choice.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className="invoice-choice-btn"
                          onClick={() => setGstMode(choice.value)}
                        >
                          {choice.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <InfoTip label="About included GST">
                  This draft was saved with GST included in the line prices. That choice stays until you pick another.
                </InfoTip>
              </div>
            ) : null}

            <div className="invoice-withholding">
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={withholdingOn}
                  aria-describedby={withholdingHintId}
                  onChange={(e) => onWithholdingChange(e.target.checked)}
                />
                Client withholds tax
              </label>
              <span className="muted small" id={withholdingHintId}>
                For contractors whose client deducts tax (IR330C). Taken off the GST-exclusive amount.
              </span>
              {withholdingOn ? (
                <label className="invoice-withholding-rate">
                  Withholding rate (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    inputMode="decimal"
                    value={withholdingPct}
                    aria-describedby={withholdingHintId}
                    onChange={(e) => setWithholdingPct(e.target.value)}
                  />
                </label>
              ) : null}
            </div>

            <details className="invoice-more" open={notesOpen} onToggle={(e) => setNotesOpen(e.currentTarget.open)}>
              <summary>Notes and payment</summary>
              <div className="form-grid">
                <label className="span-2">
                  Payment instructions
                  <textarea rows={2} maxLength={1000} value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} />
                  <span className="muted small">
                    Your bank account ({business?.bankAccount || 'not set'}) and the invoice number are added as the payment reference.
                  </span>
                </label>
                <label className="span-2">
                  Notes
                  <textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
              </div>
            </details>
          </section>

          <section className="panel">
            <div className="invoice-receive" aria-live="polite" aria-atomic="true">
              <span className="invoice-receive-label">You'll receive</span>
              <span className="invoice-receive-amount">{receive == null ? INVOICE_MISSING : formatNzd(receive)}</span>
              <span className="invoice-receive-note">
                {totals.withholding > 0
                  ? `After ${totals.withholdingRatePct}% withholding tax (${formatNzd(totals.withholding)})`
                  : 'No withholding tax deducted'}
              </span>
            </div>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <div className="invoice-editor-actions">
              <button
                type="button"
                className="btn primary"
                disabled={actionsDisabled}
                aria-describedby={actionBlock ? actionReasonId : undefined}
                onClick={() => void markSent()}
              >
                Mark as sent
              </button>
              <button
                type="button"
                className="btn"
                disabled={actionsDisabled}
                aria-describedby={actionBlock ? actionReasonId : undefined}
                onClick={() => void save()}
              >
                Save draft
              </button>
              {actionBlock ? (
                <p id={actionReasonId} className="muted small invoice-action-reason">
                  {actionBlock}
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="invoice-editor-preview" aria-labelledby="invoice-preview-heading">
          <h3 id="invoice-preview-heading">Preview</h3>
          {promptLead ? (
            <p className="invoice-business-prompt">
              {promptLead}{' '}
              {businessId ? <Link to={`/business/${businessId}`}>its business details</Link> : <Link to={BUSINESS_SETTINGS_HREF}>Settings → Business</Link>}.
            </p>
          ) : null}
          {preview ? <InvoicePreview invoice={preview} /> : null}
        </section>
      </div>
    </div>
  );
}
