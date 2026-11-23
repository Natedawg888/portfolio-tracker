/**
 * Shows a recovery code once (KAN-111/117): at signup, after a reset, or when a new one is made.
 * The user must confirm they've saved it. Without the password and this code, encrypted data can't
 * be recovered, and the dialog says so plainly.
 */
import { useState } from 'react';

export function RecoveryCodeDialog({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const download = () => {
    const blob = new Blob([`KoruLedger recovery code\n\n${code}\n\nKeep this somewhere safe and private. It resets your password and keeps your data readable.\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'koruledger-recovery-code.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <div className="modal-header">
          <h3 id="recovery-title">Save your recovery code</h3>
        </div>
        <p className="small">
          Your data is encrypted with a key only you can unlock. If you forget your password, this code is the <strong>only</strong> way back in. We can’t
          reset it for you, and without it your data can’t be recovered.
        </p>
        <p className="recovery-code" aria-label="Recovery code">
          <code>{code}</code>
        </p>
        <div className="row gap">
          <button
            type="button"
            className="btn small"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(code)
                .then(() => setCopied(true))
                .catch(() => undefined)
            }
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn small" onClick={download}>
            Download
          </button>
        </div>
        <p className="muted small">Store it in a password manager or print it. Don’t email it to yourself. It’s shown only this once.</p>
        <label className="payslip-check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>I’ve saved my recovery code somewhere safe</span>
        </label>
        <div className="row gap modal-actions">
          <button type="button" className="btn primary" disabled={!saved} onClick={onDone}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
