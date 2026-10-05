import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { applyTheme, resolveTheme, setTheme, type Theme } from '../lib/theme';
import {
  MoneyHiddenProvider,
  setMoneyHidden,
  toggleMoneyHidden,
  useMoneyHidden,
} from '../lib/privacy';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import type { AssetClassPrefKey } from '../lib/assetClassPrefs';
import { ProfileMenu } from './ProfileMenu';
import { QuietToast } from './QuietToast';

/** Prefs that unlock at least one Value Search tool. */
const VALUE_SEARCH_NAV_PREFS: AssetClassPrefKey[] = [
  'stock',
  'crypto',
  'gomining',
  'metal',
  'forex',
  'stone',
  'collectable',
];

const links: Array<{
  to: string;
  label: string;
  end?: boolean;
  requirePref?: AssetClassPrefKey;
  /** Show nav link when any of these prefs is enabled. */
  requireAnyPref?: AssetClassPrefKey[];
}> = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/spending', label: 'Budget' },
  { to: '/debts', label: 'Debts' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/kiwisaver', label: 'KiwiSaver', requirePref: 'kiwisaver' },
  { to: '/paye', label: 'PAYE' },
  { to: '/yearly', label: 'History' },
  { to: '/economic-cycle', label: 'Economic cycle' },
  { to: '/value-search', label: 'Value search', requireAnyPref: VALUE_SEARCH_NAV_PREFS },
];

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" />
    </svg>
  );
}

function EyeOpenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function Layout() {
  const { enabled } = useAssetClassPrefs();
  const location = useLocation();
  const [theme, setThemeState] = useState<Theme>(() => resolveTheme());
  const [navOpen, setNavOpen] = useState(false);
  const moneyHidden = useMoneyHidden();
  const visibleLinks = links.filter((l) => {
    if (l.requireAnyPref?.length) return l.requireAnyPref.some((k) => enabled(k));
    if (l.requirePref) return enabled(l.requirePref);
    return true;
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    if (!navOpen) {
      root.classList.remove('nav-drawer-open');
      body.classList.remove('nav-drawer-open');
      return;
    }

    const scrollY = window.scrollY;
    const previousBodyStyle = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    const onTouchMove = (e: TouchEvent) => {
      const nav = document.getElementById('app-primary-nav');
      const target = e.target;
      // Keep the page/backdrop locked, but let the drawer consume vertical
      // swipes when its own overflow area needs to scroll.
      if (nav && target instanceof Node && nav.contains(target)) return;
      e.preventDefault();
    };

    root.classList.add('nav-drawer-open');
    body.classList.add('nav-drawer-open');
    body.style.overflow = 'hidden';
    // iOS Safari can ignore overflow locking on the root scroller; pinning
    // the body prevents that scroll and the cleanup restores the exact offset.
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    document.addEventListener('keydown', onKey);
    document.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('touchmove', onTouchMove);
      body.style.overflow = previousBodyStyle.overflow;
      body.style.position = previousBodyStyle.position;
      body.style.top = previousBodyStyle.top;
      body.style.width = previousBodyStyle.width;
      root.classList.remove('nav-drawer-open');
      body.classList.remove('nav-drawer-open');
      window.scrollTo(0, scrollY);
    };
  }, [navOpen]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'portfolio-tracker-theme') {
        if (e.newValue === 'light' || e.newValue === 'dark') {
          setThemeState(e.newValue);
        }
        return;
      }
      if (e.key === 'portfolio-tracker-money-hidden') {
        setMoneyHidden(e.newValue === '1');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const choose = (next: Theme) => {
    if (next === theme) {
      applyTheme(next);
      return;
    }
    setTheme(next);
    setThemeState(next);
  };

  const handleMoneyToggle = () => {
    toggleMoneyHidden();
  };

  const openNav = () => setNavOpen(true);
  const closeNav = () => setNavOpen(false);

  return (
    <div className={'app-shell' + (navOpen ? ' nav-drawer-open' : '')}>
      {navOpen ? (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={closeNav}
        />
      ) : null}
      <header className="app-header">
        <div className="brand">
          <ProfileMenu triggerClassName="brand-mark" />
          <div>
            <h1>Portfolio Tracker</h1>
            <p className="sub">NZD · Auckland</p>
          </div>
        </div>
        {/* Mobile: fixed overlay drawer (CSS). Desktop: in-flow pill. Never inside .header-actions. */}
        <nav id="app-primary-nav" className={'nav' + (navOpen ? ' open' : '')}>
          {visibleLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              onClick={closeNav}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          {!navOpen ? (
            <button
              type="button"
              className="nav-toggle"
              aria-label="Open navigation"
              aria-expanded={false}
              aria-controls="app-primary-nav"
              onClick={openNav}
            >
              <MenuIcon />
            </button>
          ) : null}
          <div className="header-tools">
            <button
              type="button"
              className={'privacy-toggle' + (moneyHidden ? ' active' : '')}
              onClick={handleMoneyToggle}
              aria-label={moneyHidden ? 'Show monetary values' : 'Hide monetary values'}
              aria-pressed={moneyHidden}
              title={moneyHidden ? 'Show amounts' : 'Hide amounts'}
            >
              {moneyHidden ? <EyeOffIcon /> : <EyeOpenIcon />}
            </button>
            <div className="theme-switch" role="group" aria-label="Colour theme">
              <button
                type="button"
                className={theme === 'light' ? 'theme-switch-btn active' : 'theme-switch-btn'}
                onClick={() => choose('light')}
                aria-label="Light mode"
                aria-pressed={theme === 'light'}
                title="Light mode"
              >
                <SunIcon />
              </button>
              <button
                type="button"
                className={theme === 'dark' ? 'theme-switch-btn active' : 'theme-switch-btn'}
                onClick={() => choose('dark')}
                aria-label="Dark mode"
                aria-pressed={theme === 'dark'}
                title="Dark mode"
              >
                <MoonIcon />
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="app-main">
        <MoneyHiddenProvider>
          <Outlet />
        </MoneyHiddenProvider>
      </main>
      <QuietToast />
      <footer className="app-footer">
        Local-first · email/password · metals via Metals.Dev when keyed (never invented) · sync failures stay quiet
      </footer>
    </div>
  );
}
