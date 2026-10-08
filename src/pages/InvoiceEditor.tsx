/**
 * New / edit draft invoice (KAN-71), with a live preview beside the form.
 * Totals in the preview use the same maths as the server (src/lib/invoiceCalc.ts);
 * the server recomputes them on save.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatNzd, type InvoiceWriteBody } from '../api/client';
import { InvoicePreview } from '../components/InvoicePreview';
import {
  dueDateForPreset,
  DUE_PRESETS,
  INVOICE_UNIT_PRESETS,
  invoiceTotals,
  type DuePreset,
  type GstMode,
} from '../lib/invoiceCalc';
import type { BusinessProfile, InvoiceClient, PaySource, PublicInvoice } from '../types';

type LineDraft = { key: string; description: string; quantity: string; unit: string; rate: string };

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

const UNIT_OPTIONS = [...new Set(INVOICE_UNIT_PRESETS.flatMap((g) => [...g.units]))];

export function InvoiceEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const editingId = id ?? null;

  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [clients, setClients] = useState<InvoiceClient[]>([]);
  const [contractSources, setContractSources] = useState<PaySource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [number, setNumber] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientReference, setClientReference] = useState('');
  const [saveClient, setSaveClient] = useState(true);
  const [issueDate, setIssueDate] = useState(todayNz());
  const [duePreset, setDuePreset] = useState<DuePreset>('days_14');
  const [customDue, setCustomDue] = useState('');
  const [reference, setReference] = useState('');
  const [gstMode, setGstMode] = useState<GstMode>('exclusive');
  const [withholdingOn, setWithholdingOn] = useState(false);
  const [withholdingPct, setWithholdingPct] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [biz, cl, list, sources] = await Promise.all([
          api.invoices.business(),
          api.invoices.clients(),
          editingId ? Promise.resolve(null) : api.invoices.list(),
          api.paySources.list().catch(() => [] as PaySource[]),
        ]);
        if (cancelled) return;
        setBusiness(biz);
        setClients(cl);
        setContractSources(sources.filter((s) => s.inputs?.payType === 'schedular'));
        if (list) setNumber(list.nextNumber);
        if (editingId) {
          const inv = await api.invoices.get(editingId);
          if (cancelled) return;
          if (inv.storedStatus !== 'draft') {
            navigate(`/invoices/${inv.id}`, { replace: true });
            return;
          }
          setNumber(inv.number);
          setClientId(inv.clientId ?? '');
          setClientName(inv.clientName);
          setClientEmail(inv.clientEmail);
          setClientAddress(inv.clientAddress);
          setClientReference(inv.clientReference);
          setSaveClient(false);
          setIssueDate(inv.issueDate);
          setDuePreset(inv.duePreset);
          setCustomDue(inv.duePreset === 'custom' ? inv.dueDate : '');
          setReference(inv.reference);
          setGstMode(inv.gstMode === 'none' ? 'exclusive' : inv.gstMode);
          setWithholdingOn(inv.withholdingRatePct != null);
          setWithholdingPct(inv.withholdingRatePct != null ? String(inv.withholdingRatePct) : '');
          setNotes(inv.notes);
          setPaymentInstructions(inv.paymentInstructions);
          setLines(
            inv.lines.length > 0
              ? inv.lines.map((l) => ({ key: newKey(), description: l.description, quantity: String(l.quantity), unit: l.unit, rate: String(l.rate) }))
              : [blankLine()],
          );
        }
        setLoaded(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the invoice.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editingId, navigate]);

  function pickClient(nextId: string) {
    setClientId(nextId);
    const c = clients.find((x) => x.id === nextId);
    if (c) {
      setClientName(c.name);
      setClientEmail(c.email);
      setClientAddress(c.address);
      setClientReference(c.reference);
    } else {
      setClientName('');
      setClientEmail('');
      setClientAddress('');
      setClientReference('');
    }
  }

  const effectiveGst: GstMode = business?.gstRegistered ? gstMode : 'none';
  const wt = withholdingOn ? num(withholdingPct) : null;
  const dueDate = dueDateForPreset(issueDate, duePreset, customDue);

  const preview: PublicInvoice | null = useMemo(() => {
    if (!business) return null;
    const lineInputs = lines.map((l) => ({ description: l.description, quantity: num(l.quantity), unit: l.unit, rate: num(l.rate) }));
    const totals = invoiceTotals(lineInputs, effectiveGst, wt);
    return {
      number,
      title: business.gstRegistered ? 'Tax invoice' : 'Invoice',
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
  }, [business, lines, effectiveGst, wt, number, clientName, clientEmail, clientAddress, clientReference, issueDate, dueDate, reference, notes, paymentInstructions]);

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

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let cid: string | null = clientId || null;
      if (!cid && saveClient && clientName.trim()) {
        const created = await api.invoices.createClient({ name: clientName, email: clientEmail, address: clientAddress, reference: clientReference });
        cid = created.id;
        setClients((prev) => [...prev, created]);
        setClientId(created.id);
      }
      const body: InvoiceWriteBody = {
        number: number.trim() || undefined,
        clientId: cid,
        clientName,
        clientEmail,
        clientAddress,
        clientReference,
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
      const saved = editingId ? await api.invoices.update(editingId, body) : await api.invoices.create(body);
      navigate(`/invoices/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the invoice.');
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <section className="panel">
        {error ? <p className="auth-error" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <h2 className="page-title">{editingId ? `Edit ${number}` : 'New invoice'}</h2>
          <Link to={editingId ? `/invoices/${editingId}` : '/invoices'} className="btn small">
            Cancel
          </Link>
        </div>
        {business && !business.businessName.trim() ? (
          <p className="banner">
            Add your name or business name in <Link to="/settings?tab=business">Settings → Business</Link> before sending.
          </p>
        ) : null}
      </section>

      <div className="invoice-editor-layout">
        <div className="stack">
          <section className="panel">
            <h3>Client</h3>
            <div className="form-grid">
              <label className="span-2">
                Saved client
                <select value={clientId} onChange={(e) => pickClient(e.target.value)}>
                  <option value="">New client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Name
                <input value={clientName} maxLength={120} onChange={(e) => setClientName(e.target.value)} />
              </label>
              <label>
                Email
                <input type="email" value={clientEmail} maxLength={254} onChange={(e) => setClientEmail(e.target.value)} />
              </label>
              <label className="span-2">
                Address
                <textarea rows={2} value={clientAddress} maxLength={400} onChange={(e) => setClientAddress(e.target.value)} />
              </label>
              <label>
                Client reference (optional)
                <input value={clientReference} maxLength={80} onChange={(e) => setClientReference(e.target.value)} />
              </label>
              {!clientId ? (
                <label className="field checkbox-field">
                  <label className="inline-check">
                    <input type="checkbox" checked={saveClient} onChange={(e) => setSaveClient(e.target.checked)} />
                    Save to my clients
                  </label>
                </label>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <h3>Details</h3>
            <div className="form-grid">
              <label>
                Invoice number
                <input value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} />
              </label>
              <label>
                Reference / PO (optional)
                <input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
              </label>
              <label>
                Issue date
                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </label>
              <label>
                Due
                <select value={duePreset} onChange={(e) => setDuePreset(e.target.value as DuePreset)}>
                  {DUE_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {duePreset !== 'custom' ? <span className="muted small">Due {dueDate}</span> : null}
              </label>
              {duePreset === 'custom' ? (
                <label>
                  Due date
                  <input type="date" value={customDue} min={issueDate} onChange={(e) => setCustomDue(e.target.value)} />
                </label>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <h3>Lines</h3>
              <button type="button" className="btn small" onClick={() => setLines((prev) => [...prev, blankLine()])}>
                Add line
              </button>
            </div>
            {contractSources.length > 0 ? (
              <label style={{ marginTop: '0.35rem' }}>
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
                <label>
                  Description
                  <input value={l.description} maxLength={500} onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                </label>
                <label>
                  Qty
                  <input type="number" step="any" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                </label>
                <label>
                  Unit
                  <input list="invoice-units" value={l.unit} maxLength={40} onChange={(e) => updateLine(l.key, { unit: e.target.value })} />
                </label>
                <label>
                  Rate ($)
                  <input type="number" step="any" inputMode="decimal" value={l.rate} onChange={(e) => updateLine(l.key, { rate: e.target.value })} />
                </label>
                <div className="invoice-line-total">
                  <span className="muted small">Line total {formatNzd(preview?.lines[i]?.lineTotalNzd ?? 0)}</span>
                  <span className="row gap" style={{ marginTop: 0 }}>
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
                  </span>
                </div>
              </div>
            ))}
          </section>

          <section className="panel">
            <h3>Tax</h3>
            <div className="form-grid">
              {business?.gstRegistered ? (
                <label className="span-2">
                  Prices entered
                  <select value={gstMode} onChange={(e) => setGstMode(e.target.value as GstMode)}>
                    <option value="exclusive">Excluding GST (15% added on top)</option>
                    <option value="inclusive">Including GST</option>
                  </select>
                </label>
              ) : (
                <p className="muted small span-2">
                  No GST is added. If you’re GST registered, turn it on in <Link to="/settings?tab=business">Settings → Business</Link>.
                </p>
              )}
              <label className="field checkbox-field">
                <label className="inline-check">
                  <input type="checkbox" checked={withholdingOn} onChange={(e) => setWithholdingOn(e.target.checked)} />
                  Show withholding tax (schedular payments)
                </label>
                <span className="muted small">For contractors whose client deducts tax (IR330C). Taken off the GST-exclusive amount.</span>
              </label>
              {withholdingOn ? (
                <label>
                  Withholding rate (%)
                  <input type="number" min={0} max={100} step={0.1} value={withholdingPct} onChange={(e) => setWithholdingPct(e.target.value)} />
                </label>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <h3>Notes and payment</h3>
            <div className="form-grid">
              <label className="span-2">
                Payment instructions
                <textarea rows={2} maxLength={1000} value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} />
                <span className="muted small">
                  Your bank account ({business?.bankAccount || 'not set'}) and “use the invoice number as the reference” are added for you.
                </span>
              </label>
              <label className="span-2">
                Notes
                <textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>
          </section>

          <section className="panel">
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <div className="row gap">
              <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
                Save draft
              </button>
              <span className="muted small">Nothing is sent until you choose to send it.</span>
            </div>
          </section>
        </div>

        <div className="invoice-editor-preview">{preview ? <InvoicePreview invoice={preview} /> : null}</div>
      </div>
    </div>
  );
}
