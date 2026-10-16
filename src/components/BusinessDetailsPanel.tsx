/**
 * Settings → Business (KAN-71): the details printed on every invoice.
 * Saved once and pre-filled on each invoice; a sent invoice keeps the copy it was sent with.
 * Grouped cards, formatting as you type, a live invoice header preview, and a save bar that
 * appears only when something has changed.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { api } from '../api/client';
import { isValidEmail, nextInvoiceNumber } from '../lib/invoiceCalc';
import {
  applyFormattedInput,
  changedFields,
  checkBankAccount,
  checkGstNumber,
  checkInvoicePrefix,
  checkNzbn,
  effectivePrefix,
  formatBankAccount,
  formatGstNumber,
  formatNzbn,
  nextNumbersLine,
  normalizeSavedBankAccount,
  type FieldCheck,
} from '../lib/businessForm';
import { showQuietToast } from '../lib/quietToast';
import { businessComplete, businessPromptLead } from '../pages/invoicesView';
import type { BusinessProfile } from '../types';
import { BusinessHeaderPreview } from './BusinessHeaderPreview';

const LEAVE_WARNING = 'You have unsaved business details. Leave without saving?';

/** Shown under a field: ✓ for ok, ! for a problem, plain for a hint. Never colour alone. */
function Message({ id, check }: { id: string; check: FieldCheck }) {
  const mark = check.tone === 'ok' ? '✓ ' : check.tone === 'error' ? '! ' : '';
  return (
    <span id={id} className={`biz-msg biz-msg--${check.tone}`}>
      {mark ? <span aria-hidden>{mark}</span> : null}
      {check.tone === 'error' ? <span className="sr-only">Problem: </span> : null}
      {check.text}
    </span>
  );
}

/** One labelled input. The message is linked with aria-describedby so screen readers read it with the field. */
function Field({
  label,
  optional = false,
  check,
  wide = false,
  children,
}: {
  label: string;
  optional?: boolean;
  check?: FieldCheck | null;
  wide?: boolean;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={wide ? 'biz-field biz-field--wide' : 'biz-field'}>
      <label htmlFor={id}>
        {label}
        {optional ? <span className="biz-optional"> (optional)</span> : null}
      </label>
      {children({ id, describedBy: check ? msgId : undefined, invalid: check?.tone === 'error' })}
      {check ? <Message id={msgId} check={check} /> : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="panel biz-card" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <div className="biz-grid">{children}</div>
    </section>
  );
}

/** Saved values as the form shows them (standard bank format), so loading isn't an unsaved change. */
function asForm(p: BusinessProfile): BusinessProfile {
  return { ...p, bankAccount: normalizeSavedBankAccount(p.bankAccount) };
}

export function BusinessDetailsPanel() {
  const [saved, setSaved] = useState<BusinessProfile | null>(null);
  const [form, setForm] = useState<BusinessProfile | null>(null);
  const [usedNumbers, setUsedNumbers] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const [announce, setAnnounce] = useState('');
  const caretRef = useRef<{ el: HTMLInputElement; at: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.invoices
      .business()
      .then((p) => {
        if (cancelled) return;
        const f = asForm(p);
        setSaved(f);
        setForm(f);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load business details.');
      });
    // Every invoice number already used, so "Next invoice" matches what the next invoice gets.
    api.invoices
      .list()
      .then((r) => {
        if (!cancelled) setUsedNumbers(r.invoices.map((i) => i.number));
      })
      .catch(() => {
        if (!cancelled) setUsedNumbers(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Put the caret back after a formatted field rewrites its value.
  useLayoutEffect(() => {
    const c = caretRef.current;
    if (c && document.activeElement === c.el) c.el.setSelectionRange(c.at, c.at);
    caretRef.current = null;
  });

  const changed = saved && form ? changedFields(saved, form) : [];
  const dirty = changed.length > 0;

  // Warn before leaving: closing or reloading the tab, in-app links, and the Settings section buttons.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      const leaving = target?.closest('a[href]:not([target="_blank"]), .settings-side-link:not(.active)');
      if (!leaving || leaving.closest('.biz-page')) return;
      if (!window.confirm(LEAVE_WARNING)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  // Checks, computed even before load so the announcer hook below runs on every render.
  const bankCheck = form ? checkBankAccount(form.bankAccount) : null;
  // A saved bank account in an older free-text format doesn't block saving other changes.
  const bankBlocks = bankCheck?.tone === 'error' && saved != null && form != null && form.bankAccount !== saved.bankAccount;
  const gstCheck = form?.gstRegistered ? checkGstNumber(form.gstNumber, true) : null;
  const nzbnCheck = form ? checkNzbn(form.nzbn) : null;
  const prefixProblem = form ? checkInvoicePrefix(form.invoicePrefix) : null;
  const emailBad = form ? form.email.trim() !== '' && !isValidEmail(form.email) : false;
  const emailCheck: FieldCheck | null = emailBad && emailTouched
    ? { tone: 'error', text: 'Enter a full email address, for example you@example.com.' }
    : { tone: 'hint', text: 'Clients reply to this address.' };

  const problems: string[] = [];
  if (emailBad) problems.push('email address');
  if (bankBlocks) problems.push('bank account');
  if (gstCheck?.tone === 'error') problems.push('GST number');
  if (nzbnCheck?.tone === 'error') problems.push('NZBN');
  if (prefixProblem) problems.push('invoice prefix');

  // Announce when a field's message changes kind (e.g. becomes valid, or a problem appears),
  // after a short pause so screen readers aren't read every keystroke.
  const toneKey = [bankCheck?.tone, gstCheck?.tone, nzbnCheck?.tone, prefixProblem ? 'error' : 'ok', emailCheck.tone].join();
  const lastTones = useRef<string | null>(null);
  const liveText = [
    bankCheck && bankCheck.tone !== 'hint' ? `Bank account: ${bankCheck.text}` : null,
    gstCheck && gstCheck.tone !== 'hint' ? `GST number: ${gstCheck.text}` : null,
    nzbnCheck?.tone === 'error' ? `NZBN: ${nzbnCheck.text}` : null,
    prefixProblem ? `Invoice prefix: ${prefixProblem.text}` : null,
    emailCheck.tone === 'error' ? `Email: ${emailCheck.text}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  useEffect(() => {
    if (!form) return;
    if (lastTones.current === null) {
      lastTones.current = toneKey;
      return;
    }
    if (lastTones.current === toneKey) return;
    lastTones.current = toneKey;
    const t = setTimeout(() => setAnnounce(liveText), 700);
    return () => clearTimeout(t);
    // liveText follows toneKey; only a change of kind triggers an announcement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toneKey, form == null]);

  const header = (
    <header className="biz-head">
      <h2>Business details</h2>
      <p className="page-lead">
        Printed on your invoices. Invoices you’ve already sent keep the details they were sent with.
      </p>
    </header>
  );

  if (!form || !saved) {
    return (
      <div className="biz-page stack">
        {header}
        {error ? <p className="auth-error" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  const set = <K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) => {
    setForm({ ...form, [key]: value });
    setError(null);
  };

  /** Number fields: format as you type and keep the caret next to the same digit. */
  const setFormatted = (key: 'bankAccount' | 'gstNumber' | 'nzbn', format: (v: string) => string) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const el = e.target;
      const raw = el.value;
      // Bank accounts typed with words (e.g. "ANZ 12-...") are left as typed and flagged.
      if (key === 'bankAccount' && !/^[\d\s-]*$/.test(raw)) {
        set(key, raw);
        return;
      }
      const next = applyFormattedInput(form[key], raw, el.selectionStart ?? raw.length, format);
      caretRef.current = { el, at: next.caret };
      set(key, next.value);
    };

  async function save() {
    if (!form || problems.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const f = asForm(await api.invoices.saveBusiness(form));
      setSaved(f);
      setForm(f);
      setEmailTouched(false);
      showQuietToast('Business details saved', { kind: 'info', ttlMs: 4000 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    setForm(saved);
    setEmailTouched(false);
    setError(null);
  }

  const prefix = effectivePrefix(form.invoicePrefix);
  const nextLine = usedNumbers ? nextNumbersLine(form.invoicePrefix, usedNumbers) : null;
  const nextNumber = usedNumbers ? nextInvoiceNumber(usedNumbers, prefix) : null;
  const prefixCheck: FieldCheck = prefixProblem ?? {
    tone: 'hint',
    text: nextLine
      ? `${nextLine}. Invoices you’ve already numbered keep their numbers.`
      : `New invoices are numbered ${prefix}0001, ${prefix}0002 and so on.`,
  };

  // Same rule as the Invoices page (businessComplete); a filled-in value with a format problem isn't done yet.
  const bankOk = form.bankAccount.trim() !== '' && !bankBlocks;
  const gstOk = !form.gstRegistered || (form.gstNumber.trim() !== '' && gstCheck?.tone !== 'error');
  const ready = businessComplete(form) && bankOk && gstOk;
  const missingLead = businessPromptLead(form);
  const checklist = [
    { label: 'Name or business name', done: form.businessName.trim() !== '' },
    { label: 'Bank account', done: bankOk },
    ...(form.gstRegistered ? [{ label: 'GST number', done: gstOk }] : []),
  ];

  return (
    <div className={dirty ? 'biz-page biz-page--dirty stack' : 'biz-page stack'}>
      {header}

      <div className="biz-layout">
        <form
          className="biz-form stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Card title="Who you are">
            <Field label="Your name or business name" wide>
              {({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  autoComplete="organization"
                  value={form.businessName}
                  maxLength={120}
                  onChange={(e) => set('businessName', e.target.value)}
                />
              )}
            </Field>
            <Field label="Email" check={emailCheck}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  maxLength={254}
                  onChange={(e) => set('email', e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                />
              )}
            </Field>
            <Field label="Phone" optional>
              {({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  maxLength={40}
                  onChange={(e) => set('phone', e.target.value)}
                />
              )}
            </Field>
            <Field label="Address" optional wide>
              {({ id, describedBy }) => (
                <textarea
                  id={id}
                  aria-describedby={describedBy}
                  autoComplete="street-address"
                  rows={3}
                  value={form.address}
                  maxLength={400}
                  onChange={(e) => set('address', e.target.value)}
                />
              )}
            </Field>
          </Card>

          <Card title="Getting paid">
            <Field label="Bank account" check={bankCheck} wide>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  autoComplete="off"
                  inputMode="numeric"
                  value={form.bankAccount}
                  maxLength={40}
                  placeholder="12-3456-7890123-00"
                  onChange={setFormatted('bankAccount', formatBankAccount)}
                />
              )}
            </Field>
          </Card>

          <Card title="Tax">
            <div className="biz-field biz-field--wide">
              <button
                type="button"
                className={form.gstRegistered ? 'asset-toggle on' : 'asset-toggle off'}
                role="switch"
                aria-checked={form.gstRegistered}
                onClick={() => set('gstRegistered', !form.gstRegistered)}
              >
                <span className="asset-toggle-text">
                  <span className="asset-toggle-label">GST registered</span>
                  <span className="asset-toggle-blurb">Invoices become “Tax invoice” and show GST at 15%</span>
                </span>
                <span className="asset-toggle-track" aria-hidden>
                  <span className="asset-toggle-knob" />
                </span>
              </button>
            </div>
            {form.gstRegistered ? (
              <Field label="GST number" check={gstCheck}>
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    aria-required
                    autoComplete="off"
                    inputMode="numeric"
                    value={form.gstNumber}
                    maxLength={20}
                    placeholder="123-456-789"
                    onChange={setFormatted('gstNumber', formatGstNumber)}
                  />
                )}
              </Field>
            ) : null}
            <Field label="NZBN" optional check={nzbnCheck}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  autoComplete="off"
                  inputMode="numeric"
                  value={form.nzbn}
                  maxLength={20}
                  onChange={setFormatted('nzbn', formatNzbn)}
                />
              )}
            </Field>
          </Card>

          <Card title="Invoice numbers">
            <Field label="Invoice number prefix" check={prefixCheck} wide>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  className="biz-input--short"
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  autoComplete="off"
                  value={form.invoicePrefix}
                  maxLength={12}
                  placeholder="INV-"
                  onChange={(e) => set('invoicePrefix', e.target.value)}
                />
              )}
            </Field>
          </Card>

          {dirty ? (
            <div className="biz-savebar" role="region" aria-label="Unsaved changes">
              <div className="biz-savebar-text">
                <strong>
                  {changed.length} unsaved change{changed.length === 1 ? '' : 's'}
                </strong>
                {problems.length > 0 ? (
                  <span className="biz-savebar-why">Fix the {joinWords(problems)} to save.</span>
                ) : null}
                {error ? (
                  <span className="biz-savebar-why" role="alert">
                    {error}
                  </span>
                ) : null}
              </div>
              <div className="biz-savebar-actions">
                <button type="button" className="btn" disabled={busy} onClick={discard}>
                  Discard
                </button>
                <button type="submit" className="btn primary" disabled={busy || problems.length > 0}>
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          ) : null}
        </form>

        <aside className="biz-aside stack" aria-label="How your invoices will look">
          <section className="panel biz-ready" aria-labelledby="biz-ready-title">
            <h3 id="biz-ready-title">Ready to send invoices?</h3>
            {ready ? (
              <p className="biz-ready-ok">
                <span aria-hidden>✓ </span>Ready to send invoices
              </p>
            ) : (
              <p className="muted small">
                {missingLead ? `${missingLead.replace(/ in$/, '')} below.` : 'Fix the details marked below.'}
              </p>
            )}
            <ul className="biz-checklist">
              {checklist.map((c) => (
                <li key={c.label} className={c.done ? 'done' : 'todo'}>
                  <span aria-hidden>{c.done ? '✓' : '○'}</span> {c.label}
                  <span className="sr-only">{c.done ? ' — done' : ' — missing'}</span>
                </li>
              ))}
            </ul>
          </section>
          <div className="biz-preview">
            <div className="biz-preview-label">Preview{dirty ? ' (unsaved)' : ''}</div>
            <BusinessHeaderPreview profile={form} nextNumber={nextNumber} />
          </div>
        </aside>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
