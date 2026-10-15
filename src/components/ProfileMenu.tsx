import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { prefetchNavTarget } from '../lib/routePrefetch';
import { useAuth } from '../auth/AuthContext';
import { api, type RememberedAccount } from '../api/client';

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

export function ProfileMenu({ triggerClassName }: { triggerClassName?: string }) {
  const { user, logout, logoutAll, switchAccount } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [others, setOthers] = useState<RememberedAccount[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Other accounts signed in on this browser (account switcher), refreshed when the menu opens.
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
    if (!open) return;
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
  }, [open]);

  if (!user) return null;

  const composed = [user.firstName, user.lastName]
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join(' ');
  const display = user.displayName?.trim() || composed;
  const label = display || user.email;
  const initial = initials(user.email, display || null);

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

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        type="button"
        className={triggerClassName ? `${triggerClassName} profile-menu-trigger` : 'profile-menu-trigger'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${label}`}
        onClick={() => setOpen((v) => !v)}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="profile-avatar-img" />
        ) : (
          <span className="profile-avatar-fallback" aria-hidden>
            {initial}
          </span>
        )}
      </button>
      {open ? (
        <div className="profile-menu-dropdown" role="menu">
          <div className="profile-menu-owner">
            <div className="profile-menu-owner-name">{display || 'Account'}</div>
            <div className="profile-menu-owner-email" title={user.email}>
              {user.email}
            </div>
          </div>
          <div className="profile-menu-sep" role="separator" />
          {others.map((a) => (
            <button
              key={a.userId}
              type="button"
              role="menuitem"
              className="profile-menu-item profile-menu-account"
              disabled={switching !== null}
              onClick={() => void onSwitch(a.userId)}
              title={`Switch to ${a.email}`}
            >
              <span className="profile-avatar-fallback profile-menu-account-avatar" aria-hidden>
                {initials(a.email, a.displayName)}
              </span>
              <span className="profile-menu-account-text">
                <span>{a.displayName || a.email}</span>
                {a.displayName ? <span className="muted small">{a.email}</span> : null}
              </span>
              {switching === a.userId ? <span className="muted small">Switching…</span> : null}
            </button>
          ))}
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
          <div className="profile-menu-sep" role="separator" />
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
            {loggingOut ? 'Signing out…' : others.length ? `Sign out of ${user.email}` : 'Sign out'}
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
        </div>
      ) : null}
    </div>
  );
}
