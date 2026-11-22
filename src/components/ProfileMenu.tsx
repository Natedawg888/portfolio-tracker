import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { prefetchNavTarget } from '../lib/routePrefetch';
import { offersHousehold } from '../lib/usageMode';
import { useMaxWidth } from '../lib/useMaxWidth';
import { useAuth } from '../auth/AuthContext';
import { AccountTypePill } from './AccountTypePill';
import { ProfileSheet } from './phoneChrome';
import { ApiError, api, type RememberedAccount } from '../api/client';
import { clearPageCache } from '../lib/pageDataCache';
import { refreshAccountLinks } from '../lib/useAccountLinks';
import {
  BUSINESS_ACCOUNT_HREF,
  DASHBOARD_AFTER_SWITCH,
  accountSwitchRowState,
  accountSwitchTarget,
  accountSwitcherRows,
  businessNameForAccount,
  otherAccountLine,
  resetSwitchOnMenuOpen,
  showAccountsGroup,
  showAddBusinessAccountMenuRow,
  signOutMenuLabel,
  switchAccountErrorCopy,
  visibleAccountEmail,
  type AccountSwitchPhase,
} from '../lib/accountLinksView';
import type { AccountLinksResponse } from '../types/accountLinks';
import { AccountSwitchRow } from './AccountSwitchRow';

function initials(email: string, displayName: string | null): string {
  const name = (displayName || '').trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  const local = email.split('@')[0] || '?';
  return local.slice(0, 2).toUpperCase();
}

export function ProfileMenu({
  triggerClassName,
  links,
  activeBusinessName,
  account,
}: {
  triggerClassName?: string;
  links: AccountLinksResponse | null;
  activeBusinessName?: string | null;
  /** Linked account shown on the phone trigger. Desktop keeps the avatar. */
  account?: { name: string; pill: 'personal' | 'business' } | null;
}) {
  const { user, logout, logoutAll, switchAccount } = useAuth();
  const navigate = useNavigate();
  const phone = useMaxWidth(639);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [others, setOthers] = useState<RememberedAccount[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [phase, setPhase] = useState<AccountSwitchPhase>({ kind: 'idle' });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const switchLock = useRef(false);
  const sheetWasOpen = useRef(false);
  const phoneRef = useRef(phone);
  const closeMenu = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.auth
      .accounts()
      .then((r) => {
        if (!cancelled) setOthers(r.accounts.filter((a) => !a.current));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    // The phone sheet handles its own dismiss. Desktop keeps the dropdown as it was.
    if (!open || phone) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, phone]);

  useEffect(() => {
    if (phoneRef.current === phone) return;
    phoneRef.current = phone;
    setOpen(false);
  }, [phone]);

  useEffect(() => {
    if (open && phone) {
      sheetWasOpen.current = true;
      return;
    }
    if (!sheetWasOpen.current) return;
    sheetWasOpen.current = false;
    triggerRef.current?.focus({ preventScroll: true });
  }, [open, phone]);

  if (!user) return null;

  const composed = [user.firstName, user.lastName]
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(' ');
  const display = user.displayName?.trim() || composed;
  const shownEmail = visibleAccountEmail(user.email);
  const label = display || shownEmail || 'Account';
  const initial = initials(shownEmail ?? '', display || null);
  const accountsGroup = showAccountsGroup(links);
  const rows = links && accountsGroup ? accountSwitcherRows(links, activeBusinessName) : [];
  const linkedBusy = phase.kind === 'switching';

  const onLogout = async (all = false) => {
    setLoggingOut(true);
    try {
      await (all ? logoutAll() : logout());
    } finally {
      setLoggingOut(false);
      setOpen(false);
    }
  };

  const onSwitch = async (userId: string) => {
    setSwitching(userId);
    try {
      await switchAccount(userId);
    } catch {
      // The other session ended — drop it from the list.
      setOthers((list) => list.filter((a) => a.userId !== userId));
      setSwitching(null);
    }
  };

  const onLinkedSwitch = async (accountId: string) => {
    if (switchLock.current) return;
    switchLock.current = true;
    setPhase({ kind: 'switching', accountId });
    try {
      await api.accountLinks.switch({ accountId });
      clearPageCache();
      refreshAccountLinks();
      setOpen(false);
      window.location.assign(DASHBOARD_AFTER_SWITCH);
    } catch (err) {
      switchLock.current = false;
      setPhase({
        kind: 'failed',
        accountId,
        message: switchAccountErrorCopy(err instanceof ApiError ? err.code : undefined),
      });
    }
  };

  const phoneAccount = phone && account ? account : null;
  const menuBody = (
    <>
      {rows.length > 0 ? (
        <div className="profile-menu-accounts" role="group" aria-label="Accounts">
          <div className="profile-menu-accounts-label">Accounts</div>
          {rows.map((row) => {
            const state = accountSwitchRowState(row, phase);
            const target = accountSwitchTarget(row, phase);
            return (
              <AccountSwitchRow
                key={row.id}
                id={row.id}
                name={row.name}
                pill={row.pill}
                current={state.ariaCurrent}
                disabled={state.disabled || switching !== null}
                blocked={state.blocked}
                statusText={state.statusText}
                onClick={() => {
                  if (target) void onLinkedSwitch(target);
                }}
              />
            );
          })}
        </div>
      ) : null}
      {rows.length > 0 ? <div className="profile-menu-sep" role="separator" /> : null}
      <div className="profile-menu-owner">
        <div className="profile-menu-owner-name">{display || 'Account'}</div>
        {shownEmail ? (
          <div className="profile-menu-owner-email" title={shownEmail}>
            {shownEmail}
          </div>
        ) : null}
      </div>
      <div className="profile-menu-sep" role="separator" />
      {others.map((a) => {
        const line = otherAccountLine({
          displayName: a.displayName,
          businessName: businessNameForAccount(a.userId, links, activeBusinessName),
          email: a.email,
        });
        return (
          <button
            key={a.userId}
            type="button"
            role="menuitem"
            className="profile-menu-item profile-menu-account"
            disabled={switching !== null || linkedBusy}
            onClick={() => void onSwitch(a.userId)}
            title={`Switch to ${line.name}`}
          >
            <span className="profile-avatar-fallback profile-menu-account-avatar" aria-hidden>
              {initials(line.email ?? '', line.name)}
            </span>
            <span className="profile-menu-account-text">
              <span>{line.name}</span>
              {line.email ? <span className="muted small">{line.email}</span> : null}
            </span>
            {switching === a.userId ? <span className="muted small">Switching…</span> : null}
          </button>
        );
      })}
      <button
        type="button"
        role="menuitem"
        className="profile-menu-item"
        onClick={() => {
          setOpen(false);
          navigate('/login?add=1');
        }}
      >
        Add another account
      </button>
      {showAddBusinessAccountMenuRow({
        active: user.activeAccount,
        linkedCount: links ? links.linked.length : null,
        accountsGroup,
      }) ? (
        <Link
          to={BUSINESS_ACCOUNT_HREF}
          role="menuitem"
          className="profile-menu-item"
          onClick={() => setOpen(false)}
          onMouseEnter={() => prefetchNavTarget('/settings')}
          onFocus={() => prefetchNavTarget('/settings')}
          onTouchStart={() => prefetchNavTarget('/settings')}
        >
          Add business account
        </Link>
      ) : null}
      <div className="profile-menu-sep" role="separator" />
      {!user || offersHousehold(user.usageMode) ? (
        <Link
          to="/household"
          role="menuitem"
          className="profile-menu-item"
          onClick={() => setOpen(false)}
          onMouseEnter={() => prefetchNavTarget('/household')}
          onFocus={() => prefetchNavTarget('/household')}
          onTouchStart={() => prefetchNavTarget('/household')}
        >
          Household
        </Link>
      ) : null}
      <Link
        to="/settings?tab=account"
        role="menuitem"
        className="profile-menu-item"
        onClick={() => setOpen(false)}
        onMouseEnter={() => prefetchNavTarget('/settings')}
        onFocus={() => prefetchNavTarget('/settings')}
        onTouchStart={() => prefetchNavTarget('/settings')}
      >
        Settings
      </Link>
      <button
        type="button"
        role="menuitem"
        className="profile-menu-item danger"
        disabled={loggingOut}
        onClick={() => void onLogout()}
      >
        {loggingOut ? 'Signing out…' : signOutMenuLabel(user.email, others.length > 0, display || null)}
      </button>
      {others.length ? (
        <button
          type="button"
          role="menuitem"
          className="profile-menu-item danger"
          disabled={loggingOut}
          onClick={() => void onLogout(true)}
        >
          Sign out of all accounts
        </button>
      ) : null}
    </>
  );

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={
          phoneAccount
            ? 'profile-menu-trigger profile-account-trigger'
            : triggerClassName
              ? `${triggerClassName} profile-menu-trigger`
              : 'profile-menu-trigger'
        }
        aria-haspopup={phone ? 'dialog' : 'menu'}
        aria-expanded={open}
        aria-label={`Account menu for ${label}`}
        data-tour="account"
        onClick={() => {
          if (!open && resetSwitchOnMenuOpen(phase)) {
            setPhase({ kind: 'idle' });
            switchLock.current = false;
          }
          setOpen((isOpen) => !isOpen);
        }}
      >
        {phoneAccount ? (
          <span className="profile-trigger-account">
            <span className="account-context-name">{phoneAccount.name}</span>
            <AccountTypePill type={phoneAccount.pill} />
          </span>
        ) : user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="profile-avatar-img" />
        ) : (
          <span className="profile-avatar-fallback" aria-hidden>
            {initial}
          </span>
        )}
      </button>
      {open && !phone ? (
        <div className="profile-menu-dropdown" role="menu">
          {menuBody}
        </div>
      ) : null}
      {open && phone
        ? createPortal(
            <ProfileSheet onClose={closeMenu} ignoreRef={triggerRef}>
              <div className="profile-sheet-menu" role="menu">
                {menuBody}
              </div>
            </ProfileSheet>,
            document.body,
          )
        : null}
    </div>
  );
}
