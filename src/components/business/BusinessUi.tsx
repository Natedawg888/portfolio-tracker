/**
 * Shared pieces of the Business pages (KAN-84): the Overview / Invoices / Clients tabs, the
 * dialog and its save row, the tax year switch and the income / expenses / net figures.
 */
import { useId, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { formatNzd } from '../../api/client';
import { taxYearLabel } from '../../lib/business';
import type { BusinessTotals } from '../../types';

export function BusinessTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => `portfolio-tab${isActive ? ' active' : ''}`;
  return (
    <nav className="portfolio-tabs business-tabs" aria-label="Business">
      <NavLink to="/business" end className={cls}>
        Overview
      </NavLink>
      <NavLink to="/business/invoices" className={cls}>
        Invoices
      </NavLink>
      <NavLink to="/business/clients" className={cls}>
        Clients
      </NavLink>
    </nav>
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

export function BusinessFigures({ totals }: { totals: BusinessTotals }) {
  return (
    <dl className="rental-totals business-totals">
      <div>
        <dt>Income</dt>
        <dd>{formatNzd(totals.incomeNzd)}</dd>
      </div>
      <div>
        <dt>Expenses</dt>
        <dd>{formatNzd(totals.expensesNzd)}</dd>
      </div>
      <div>
        <dt>Net</dt>
        <dd className={totals.netNzd < 0 ? 'rental-net--loss' : undefined}>{formatNzd(totals.netNzd)}</dd>
      </div>
      <div>
        <dt>Assets</dt>
        <dd>{totals.assetsNzd == null ? '—' : formatNzd(totals.assetsNzd)}</dd>
      </div>
    </dl>
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
