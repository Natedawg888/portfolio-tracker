import { accountSwitchErrorId } from '../lib/accountLinksView';
import { AccountTypePill } from './AccountTypePill';

/** One account in the profile menu. The error is described, not announced as a nested alert. */
export function AccountSwitchRow({
  id,
  name,
  pill,
  current,
  disabled,
  blocked,
  statusText,
  onClick,
}: {
  id: string;
  name: string;
  pill: 'personal' | 'business';
  current: boolean;
  disabled: boolean;
  blocked: boolean;
  statusText: string | null;
  onClick: () => void;
}) {
  const error = statusText !== null && statusText !== 'Current' && statusText !== 'Switching…';
  const errorId = accountSwitchErrorId(id);
  return (
    <button
      type="button"
      role="menuitem"
      className={'profile-menu-switch-row' + (blocked ? ' is-blocked' : '')}
      aria-current={current ? 'true' : undefined}
      aria-describedby={error ? errorId : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="profile-menu-switch-row-line">
        <span className="profile-menu-switch-row-name">{name}</span>
        <AccountTypePill type={pill} />
        {statusText === 'Current' || statusText === 'Switching…' ? (
          <span className="profile-menu-switch-row-status">{statusText}</span>
        ) : null}
      </span>
      {error ? (
        <span id={errorId} className="profile-menu-switch-row-error">
          {statusText}
        </span>
      ) : null}
    </button>
  );
}
