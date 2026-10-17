/**
 * Shared pieces of the Business pages (KAN-84): the Overview / Invoices / Clients tabs, the
 * dialog and its save row, the tax year switch, the money in / costs / profit figures, the net
 * worth switch and the one-line note for the business type.
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { formatNzd } from '../../api/client';
import { BUSINESS_TYPES, BUSINESS_TYPE_NOTES, businessTypeLabel, profitClass, taxYearLabel, type BusinessType } from '../../lib/business';
import type { BusinessTotals } from '../../types';

const TABS = [
  { to: '/business', label: 'Overview', match: (p: string) => p === '/business' || /^\/business\/(?!invoices|clients)[^/]+$/.test(p) },
  { to: '/business/invoices', label: 'Invoices', match: (p: string) => p.startsWith('/business/invoices') },
  { to: '/business/clients', label: 'Clients', match: (p: string) => p.startsWith('/business/clients') },
];

/** Overview / Invoices / Clients. Each is its own page, so the tabs are links; arrow keys move between them. */
export function BusinessTabs() {
  const { pathname } = useLocation();
  const listRef = useRef<HTMLDivElement>(null);
  const active = Math.max(0, TABS.findIndex((t) => t.match(pathname)));
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const links = [...(listRef.current?.querySelectorAll<HTMLAnchorElement>('[role="tab"]') ?? [])];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' ? (i + 1) % links.length : e.key === 'ArrowLeft' ? (i - 1 + links.length) % links.length : e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    links[next].focus();
  }
  return (
    <div ref={listRef} className="portfolio-tabs business-tabs" role="tablist" aria-label="Business" onKeyDown={onKeyDown}>
      {TABS.map((t, i) => (
        <Link key={t.to} to={t.to} role="tab" aria-selected={i === active} tabIndex={i === active ? 0 : -1} className={`portfolio-tab${i === active ? ' active' : ''}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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

export function FormActions({ busy, hint, saveLabel, onSave, onClose }: {
  busy: boolean;
  /** Why save is off; null when the form can be saved. */
  hint: string | null;
  saveLabel: string;
  onSave: () => void;
  onClose: () => void;
}) {
  const hintId = useId();
  return (
    <div className="row gap modal-actions warranty-form-actions">
      <button type="button" className="btn primary" disabled={busy || hint != null} aria-describedby={hint ? hintId : undefined} onClick={onSave}>
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

export function TaxYearSwitch({ year, years, onChange }: { year: number; years: number[]; onChange: (year: number) => void }) {
  const i = years.indexOf(year);
  return (
    <nav className="budget-month-switch" aria-label="Tax year">
      <button type="button" className="budget-month-step" disabled={i < 0 || i >= years.length - 1} aria-label="Previous tax year" onClick={() => onChange(years[i + 1])}>
        ‹
      </button>
      <span className="budget-month-label" aria-live="polite">
        {taxYearLabel(year)} tax year
      </span>
      <button type="button" className="budget-month-step" disabled={i <= 0} aria-label="Next tax year" onClick={() => onChange(years[i - 1])}>
        ›
      </button>
    </nav>
  );
}

/**
 * Money in, costs and profit for the tax year, and what the business owns. `assetsLabel` names
 * the last figure; `assetsNote` sits under it (whether it counts in net worth).
 */
export function BusinessFigures({ totals, assetsLabel, assetsNote, showAssets = true }: {
  totals: BusinessTotals;
  assetsLabel: string;
  assetsNote?: ReactNode;
  showAssets?: boolean;
}) {
  return (
    <dl className={'rental-totals business-totals' + (showAssets ? '' : ' business-totals--three')}>
      <div>
        <dt>Money in</dt>
        <dd>{formatNzd(totals.incomeNzd)}</dd>
      </div>
      <div>
        <dt>Costs</dt>
        <dd>{formatNzd(totals.expensesNzd)}</dd>
      </div>
      <div>
        <dt>Profit</dt>
        <dd className={profitClass(totals.netNzd)}>{formatNzd(totals.netNzd)}</dd>
      </div>
      {showAssets ? (
        <div>
          <dt>{assetsLabel}</dt>
          <dd>{totals.assetsNzd == null ? '—' : formatNzd(totals.assetsNzd)}</dd>
          {assetsNote ? <dd className="business-figure-note">{assetsNote}</dd> : null}
        </div>
      ) : null}
    </dl>
  );
}

/** role="switch" for "Count what it owns in my net worth" (same look as Settings → Categories & assets). */
export function NetWorthSwitch({ on, busy, name, onChange }: { on: boolean; busy: boolean; name: string; onChange: (on: boolean) => void }) {
  const labelId = useId();
  const descId = useId();
  return (
    <button
      type="button"
      className={'asset-toggle business-networth-switch ' + (on ? 'on' : 'off')}
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      aria-describedby={descId}
      disabled={busy}
      onClick={() => onChange(!on)}
    >
      <span className="asset-toggle-text">
        <span className="asset-toggle-label" id={labelId}>
          Count what it owns in my net worth
        </span>
        <span className="asset-toggle-blurb" id={descId}>
          {name ? `${name}’s assets` : 'Its assets'} in net worth, History and Projections. Produce is counted on Portfolio → Commodities.
        </span>
      </span>
      <span className="asset-toggle-state" aria-hidden>
        {on ? 'On' : 'Off'}
      </span>
      <span className="asset-toggle-track" aria-hidden>
        <span className="asset-toggle-knob" />
      </span>
    </button>
  );
}

/** One-line note for the business type, with a "Change type" link that opens type buttons in place. */
export function TypeNote({ type, name, busy, onChange }: { type: BusinessType; name: string; busy?: boolean; onChange: (type: BusinessType) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupId = useId();
  return (
    <div className="business-type-note">
      <p className="muted small">
        <strong>{businessTypeLabel(type)}:</strong> {BUSINESS_TYPE_NOTES[type]}{' '}
        <button type="button" className="link-btn" aria-expanded={open} aria-controls={open ? groupId : undefined} onClick={() => setOpen((o) => !o)}>
          Change type<span className="sr-only"> of {name || 'this business'}</span>
        </button>
      </p>
      {open ? (
        <div id={groupId} role="group" aria-label={`Type of ${name || 'this business'}`} className="business-type-buttons">
          {BUSINESS_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={'btn small' + (t.value === type ? ' primary' : ' ghost')}
              aria-pressed={t.value === type}
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setError(null);
                  try {
                    if (t.value !== type) await onChange(t.value);
                    setOpen(false);
                  } catch (e) {
                    setError(errorText(e, 'Could not change the type.'));
                  }
                })()
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </div>
  );
}

/** Logo, or the first letter of the name. */
export function BusinessMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) return <img className="business-mark" src={logoUrl} alt="" />;
  return (
    <span className="business-mark business-mark--letter" aria-hidden="true">
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
