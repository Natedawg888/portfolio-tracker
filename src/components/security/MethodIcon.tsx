/** Small line icons for sign-in methods and devices (decorative; rows always say it in text). */
import type { MethodIconKind } from '../../lib/securityView';

export type { MethodIconKind };

const PATHS: Record<MethodIconKind, string[]> = {
  password: ['M7.5 11V8a4.5 4.5 0 0 1 9 0v3', 'M5.5 11h13v9h-13z', 'M12 14.5v2'],
  google: ['M20 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.5a4 4 0 0 1-1.7 2.6', 'M18.4 17.4A8 8 0 1 1 17.7 6.3'],
  apple: ['M15.5 3.5c-.9.1-2 .7-2.6 1.5-.6.7-1 1.7-.9 2.6 1 .1 2-.5 2.6-1.3.6-.8 1-1.8.9-2.8Z', 'M18.5 16c-.6 1.4-1.8 3.5-3.2 3.5-1.2 0-1.6-.7-3-.7s-1.9.7-3 .7C7.6 19.5 5 15.8 5 12.6 5 9.9 6.8 8.4 8.6 8.4c1.2 0 2.1.8 3 .8.8 0 2-.9 3.4-.8.6 0 2.2.2 3.2 1.7-2.9 1.8-2.3 5.2.3 5.9Z'],
  microsoft: ['M4.5 4.5h7v7h-7z', 'M12.5 4.5h7v7h-7z', 'M4.5 12.5h7v7h-7z', 'M12.5 12.5h7v7h-7z'],
  passkey: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M3.5 20c0-3.3 2.5-6 5.5-6 1.3 0 2.4.4 3.3 1.2', 'M17 12.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z', 'M17 17.5V21l1.2-1.1'],
  passkey_added: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M3.5 20c0-3.3 2.5-6 5.5-6 1.3 0 2.4.4 3.3 1.2', 'M18 13v6M15 16h6'],
  device: ['M4 5.5h16v10H4z', 'M9 19.5h6', 'M12 15.5v4'],
  shield: ['M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6L12 3Z'],
};

export function MethodIcon({ kind }: { kind: MethodIconKind }) {
  return (
    <span className={`security-icon security-icon--${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {PATHS[kind].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}
