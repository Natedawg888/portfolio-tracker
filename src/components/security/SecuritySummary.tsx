import type { AccountSecurity } from '../../api/client';
import { securitySummary } from '../../lib/securityView';

const MARK = { ok: '✓', warn: '!', info: '•' } as const;
const SR = { ok: 'Done:', warn: 'Needs attention:', info: '' } as const;

/** Top of Settings → Security: one line on how protected the account is, and why. */
export function SecuritySummary({ data }: { data: AccountSecurity }) {
  const s = securitySummary(data);
  return (
    <section className={`card security-summary security-summary--${s.tone}`} aria-labelledby="security-summary-title">
      <div className="security-summary-head">
        <span className="security-summary-icon" aria-hidden="true">
          <ShieldIcon tone={s.tone} />
        </span>
        <h3 id="security-summary-title">{s.title}</h3>
      </div>
      <ul className="security-summary-list">
        {s.items.map((i) => (
          <li key={i.key} className={`is-${i.status}`}>
            <span className="security-summary-mark" aria-hidden="true">
              {MARK[i.status]}
            </span>
            {SR[i.status] ? <span className="sr-only">{SR[i.status]} </span> : null}
            <span>
              {i.text}
              {i.href ? (
                <>
                  {i.key === 'others' ? ' · ' : ' — '}
                  <a href={i.href}>{i.linkText}</a>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ShieldIcon({ tone }: { tone: 'good' | 'ok' | 'action' }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6L12 3Z" />
      {tone === 'action' ? <path d="M12 8v4.5M12 15.5h.01" /> : <path d="m8.8 12.2 2.2 2.2 4.2-4.4" />}
    </svg>
  );
}
