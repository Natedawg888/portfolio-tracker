/**
 * Dialog shell and save / cancel row shared by the Rentals forms (KAN-66, KAN-83).
 */
import { useId, type ReactNode } from 'react';

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

export function FormActions({ busy, disabled, saveLabel, hint, onSave, onClose }: {
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
