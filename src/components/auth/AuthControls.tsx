/**
 * Small sign-in / sign-up page pieces: the password field (show / hide, Caps Lock warning),
 * the Google button, a button spinner and the one inline error message.
 * Presentation only; the page owns every sign-in call.
 */
import { forwardRef, useId, useState, type KeyboardEvent, type ReactNode } from 'react';

export function Spinner() {
  return <span className="auth-spinner" aria-hidden="true" />;
}

/** Button label with a spinner while busy. */
export function BusyLabel({ busy, busyText, children }: { busy: boolean; busyText: string; children: ReactNode }) {
  return busy ? (
    <>
      <Spinner />
      <span>{busyText}</span>
    </>
  ) : (
    <>{children}</>
  );
}

/**
 * The page's one error message: announced as it appears (role="alert", an assertive
 * live region), and focusable so the page can move focus to it after a failed attempt.
 */
export const FormError = forwardRef<HTMLParagraphElement, { message: string | null }>(function FormError({ message }, ref) {
  return message ? (
    <p ref={ref} className="auth-error" role="alert" aria-live="assertive" aria-atomic="true" tabIndex={-1}>
      {message}
    </p>
  ) : null;
});

export function PasswordField({
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const ids = { input: useId(), caps: useId() };
  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);

  return (
    <div className="auth-field">
      <label htmlFor={ids.input}>Password</label>
      <div className="auth-password">
        <input
          id={ids.input}
          type={shown ? 'text' : 'password'}
          autoComplete="current-password"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={checkCaps}
          onKeyUp={checkCaps}
          onBlur={() => setCapsLock(false)}
          aria-describedby={capsLock ? ids.caps : undefined}
          required
          disabled={disabled}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className="auth-reveal"
          aria-pressed={shown}
          aria-controls={ids.input}
          disabled={disabled}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? 'Hide' : 'Show'}
          <span className="sr-only"> password</span>
        </button>
      </div>
      <p id={ids.caps} className="auth-caps" aria-live="polite">
        {capsLock ? 'Caps Lock is on' : ''}
      </p>
    </div>
  );
}

/** Google's standard multicolour "G". */
function GoogleG() {
  return (
    <svg className="google-g" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Google's branded button (logo, approved wording and light / dark colours). */
export function GoogleButton({
  href,
  disabled = false,
  text = 'Continue with Google',
}: {
  href: string;
  disabled?: boolean;
  /** One of Google's approved labels. */
  text?: 'Continue with Google' | 'Sign up with Google' | 'Sign in with Google';
}) {
  return (
    <a className={'google-btn' + (disabled ? ' is-disabled' : '')} href={href} aria-disabled={disabled || undefined} onClick={(e) => (disabled ? e.preventDefault() : undefined)}>
      <GoogleG />
      <span>{text}</span>
    </a>
  );
}
