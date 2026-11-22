/**
 * Phone header chrome: drawer preference switches and the profile bottom sheet.
 * Desktop and tablet keep the icon controls and the dropdown.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { signOutMenuLabel } from '../lib/accountLinksView';
import { prefetchNavTarget } from '../lib/routePrefetch';
import { offersHousehold } from '../lib/usageMode';
import { AccountTypePill } from './AccountTypePill';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DrawerPreferenceToggles({
  moneyHidden,
  dark,
  onToggleMoney,
  onToggleTheme,
  markHideAmounts = false,
}: {
  moneyHidden: boolean;
  dark: boolean;
  onToggleMoney: () => void;
  onToggleTheme: () => void;
  /** Phones: this switch is the Hide amounts control, so it carries the tour target. */
  markHideAmounts?: boolean;
}) {
  return (
    <div className="mobile-nav-toggles">
      <button
        type="button"
        className="mobile-nav-switch"
        role="switch"
        aria-checked={moneyHidden}
        data-tour={markHideAmounts ? 'hide-amounts' : undefined}
        onClick={onToggleMoney}
      >
        <span className="mobile-nav-switch-label">Hide amounts</span>
        <span className="mobile-nav-switch-ui" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="mobile-nav-switch"
        role="switch"
        aria-checked={dark}
        onClick={onToggleTheme}
      >
        <span className="mobile-nav-switch-label">Dark theme</span>
        <span className="mobile-nav-switch-ui" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Same name the profile menu passes into signOutMenuLabel. */
function menuDisplayName(user: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
} | null): string | null {
  if (!user) return null;
  const composed = [user.firstName, user.lastName]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' ');
  return user.displayName?.trim() || composed || null;
}

/**
 * The drawer's sign-out row. The label matches the profile menu, and the click
 * is the same logout: with another account remembered, that switches to it
 * instead of ending the session.
 */
export function DrawerSignOutButton({
  email,
  hasOtherAccounts,
  displayName,
  signingOut,
  onClick,
}: {
  email: string | null | undefined;
  hasOtherAccounts: boolean;
  displayName: string | null;
  signingOut: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="mobile-nav-link mobile-nav-account-signout" disabled={signingOut} onClick={onClick}>
      {signingOut ? 'Signing out…' : signOutMenuLabel(email, hasOtherAccounts, displayName)}
    </button>
  );
}

/** Account links under the drawer nav. Shown on phones; the sheet still holds the full menu. */
export function DrawerAccountSection({
  account,
  onNavigate,
}: {
  account: { name: string; pill: 'personal' | 'business' } | null;
  onNavigate: () => void;
}) {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [hasOtherAccounts, setHasOtherAccounts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.auth
      .accounts()
      .then((r) => {
        if (!cancelled) setHasOtherAccounts(r.accounts.some((a) => !a.current));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const onSignOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    void logout()
      .catch(() => {
        /* The session call failed. Still leave the drawer. */
      })
      .finally(() => {
        setSigningOut(false);
        onNavigate();
      });
  };

  return (
    <div className="mobile-nav-account" role="group" aria-label="Account">
      {account ? (
        <div className="mobile-nav-account-current">
          <span className="account-context-name">{account.name}</span>
          <AccountTypePill type={account.pill} />
        </div>
      ) : null}
      {!user || offersHousehold(user.usageMode) ? (
        <NavLink
          to="/household"
          className={({ isActive }) => 'mobile-nav-link' + (isActive ? ' active' : '')}
          onClick={onNavigate}
          onFocus={() => prefetchNavTarget('/household')}
          onTouchStart={() => prefetchNavTarget('/household')}
        >
          Household
        </NavLink>
      ) : null}
      <NavLink
        to="/settings?tab=account"
        className={({ isActive }) => 'mobile-nav-link' + (isActive ? ' active' : '')}
        onClick={onNavigate}
        onFocus={() => prefetchNavTarget('/settings')}
        onTouchStart={() => prefetchNavTarget('/settings')}
      >
        Settings
      </NavLink>
      <DrawerSignOutButton
        email={user?.email}
        hasOtherAccounts={hasOtherAccounts}
        displayName={menuDisplayName(user)}
        signingOut={signingOut}
        onClick={onSignOut}
      />
    </div>
  );
}

/**
 * Phone profile menu. Rendered only while open. Escape, a tap outside, and Close
 * dismiss it. Tab stays inside. The caller returns focus to the trigger.
 */
export function ProfileSheet({
  children,
  onClose,
  ignoreRef,
}: {
  children?: ReactNode;
  onClose: () => void;
  /** The menu button. A press there toggles, so it must not also count as "outside". */
  ignoreRef?: RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const frame = window.requestAnimationFrame(() => {
      panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (ignoreRef?.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    const body = document.body;
    const drawerLocked = body.classList.contains('nav-drawer-open');
    const previousOverflow = body.style.overflow;
    if (!drawerLocked) body.style.overflow = 'hidden';
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
      if (!drawerLocked) body.style.overflow = previousOverflow;
    };
  }, [ignoreRef, onClose]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="profile-sheet-root">
      <div className="profile-sheet-backdrop" aria-hidden="true" onPointerDown={onClose} />
      <div
        ref={panelRef}
        className="profile-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Account menu"
        onKeyDown={onKeyDown}
      >
        {children}
        <div className="profile-sheet-close-row">
          <button type="button" className="profile-sheet-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
