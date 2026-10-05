import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { prefetchNavTarget } from '../lib/routePrefetch';
import { useAuth } from '../auth/AuthContext';

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
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      setOpen(false);
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
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
