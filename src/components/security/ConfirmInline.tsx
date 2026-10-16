/**
 * Inline confirmation for a destructive or sensitive change on Settings → Security.
 * role="alertdialog" with focus moved in (the password field when one is needed, otherwise
 * the safe button; `focus` overrides it); Escape cancels and focus goes back to the button
 * that opened it. `askCode` adds an authenticator / backup code field (two-factor changes).
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

export function ConfirmInline({
  title,
  children,
  confirmLabel,
  confirmAriaLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  askPassword = false,
  askCode = false,
  focus,
  returnFocusId,
  passwordNote,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  /** Full name for the confirm button when its visible text is short ("Turn off"). */
  confirmAriaLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warn' | 'primary';
  /** Show a "Current password" field (no recent sign-in). */
  askPassword?: boolean;
  /** Show an "Authenticator or backup code" field. */
  askCode?: boolean;
  /** What gets focus on open: the first field, or the safe (cancel) button. */
  focus?: 'field' | 'cancel';
  /** id of the button that opened this, when this replaces it on screen (focus goes back to it on close). */
  returnFocusId?: string;
  /** Shown instead of a field when a password would be needed but the account has none. */
  passwordNote?: string | null;
  busy?: boolean;
  error?: string | null;
  onConfirm: (password: string | undefined, code: string | undefined) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  // Focus once, when it opens (it remounts when a password field is added).
  const focusField = useRef((focus ?? (askPassword || askCode ? 'field' : 'cancel')) === 'field');

  useEffect(() => {
    opener.current = document.activeElement;
    (focusField.current ? (passwordRef.current ?? codeRef.current) : cancelRef.current)?.focus();
    return () => {
      const el = opener.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
      // The opener was swapped out for this confirmation: focus it once it's back.
      else if (returnFocusId) setTimeout(() => document.getElementById(returnFocusId)?.focus(), 0);
    };
  }, [returnFocusId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || passwordNote) return;
    onConfirm(askPassword ? password : undefined, askCode ? code.trim() : undefined);
  };

  return (
    <form
      className={`security-confirm security-confirm--${tone}`}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <p id={titleId} className="security-confirm-title">
        {title}
      </p>
      {children ? (
        <div id={bodyId} className="security-confirm-body">
          {children}
        </div>
      ) : null}
      {passwordNote ? (
        <p className="security-confirm-note">{passwordNote}</p>
      ) : askPassword ? (
        <label className="field security-confirm-field">
          <span>Current password</span>
          <input
            ref={passwordRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </label>
      ) : null}
      {askCode && !passwordNote ? (
        <label className="field security-confirm-field">
          <span>Code from your authenticator app, or a backup code</span>
          <input
            ref={codeRef}
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            value={code}
            maxLength={20}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
            required
          />
        </label>
      ) : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="security-confirm-actions">
        <button ref={cancelRef} type="button" className="btn" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="submit"
          className={tone === 'primary' ? 'btn primary' : 'btn danger'}
          aria-label={confirmAriaLabel}
          disabled={busy || Boolean(passwordNote) || (askPassword && !password) || (askCode && !code.trim())}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </form>
  );
}
