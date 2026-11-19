import { HEADER_ACCOUNT_CURRENCY, HEADER_ACCOUNT_TIMEZONE } from '../lib/accountLinksView';
import { AccountTypePill } from './AccountTypePill';

/** Active account in the header. A missing name stays blank so a person's name is not guessed. */
export function HeaderAccountLine({ name, pill }: { name: string | null; pill: 'personal' | 'business' }) {
  return (
    <p className="sub account-context">
      {name ? <span className="account-context-name">{name}</span> : null}
      <AccountTypePill type={pill} />
      <span className="account-context-meta">
        · {HEADER_ACCOUNT_CURRENCY} · {HEADER_ACCOUNT_TIMEZONE}
      </span>
    </p>
  );
}
