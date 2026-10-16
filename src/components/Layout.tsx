import { cloneElement, isValidElement, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { readPendingInvite } from '../lib/householdInvite';
import { BrandLockup } from './BrandLockup';
import { CloseIcon, MOBILE_NAV_ID, MobileNavDrawer } from './MobileNavDrawer';
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
import { PageAds } from './PageAds';
import { api } from '../api/client';
import { metalProviderFooter } from '../lib/metalSpotCopy';
import { visibleSearchTypes } from '../lib/valueSearchDetect';
import type { ValueSearchPrefs } from '../lib/valueSearchPrefs';
import { prefetchNavTarget, schedulePrefetchAppRoutes } from '../lib/routePrefetch';

/** Pages that don't show the metals / sync / legal links footer. */
const FOOTERLESS_PATHS = new Set(['/', '/portfolio', '/debts', '/warranties', '/rentals', '/payslips', '/vehicles', '/crypto']);
/** Pages whose footer keeps only the legal links (no metals / sync note). */
const LEGAL_ONLY_FOOTER_PATHS = new Set(['/shopping']);

function legalOnlyFooter(pathname: string, search: string): boolean {
  if (LEGAL_ONLY_FOOTER_PATHS.has(pathname)) return true;
  // Settings → Business is about invoices; the metals / sync note doesn't belong there.
  return pathname === '/settings' && new URLSearchParams(search).get('tab') === 'business';
}

const links: Array<{
  to: string;
  label: string;
  end?: boolean;
  requirePref?: AssetClassPrefKey;
  /** Show the link only when the page would have something to show. */
  visible?: (enabled: (key: AssetClassPrefKey) => boolean, valueSearch: ValueSearchPrefs) => boolean;
}> = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/spending', label: 'Budget' },
  { to: '/debts', label: 'Debts' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/projections', label: 'Projections' },
  { to: '/news', label: 'News' },
  { to: '/kiwisaver', label: 'KiwiSaver', requirePref: 'kiwisaver' },
  { to: '/paye', label: 'PAYE' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/yearly', label: 'History' },
  { to: '/economic-cycle', label: 'Economic cycle' },
  {
    to: '/value-search',
    label: 'Value search',
    visible: (enabled, valueSearch) => visibleSearchTypes(enabled, valueSearch).length > 0,
  },
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

export function Layout({ children }: { children?: ReactNode }) {
  const { enabled, valueSearch } = useAssetClassPrefs();
  const location = useLocation();
  const [theme, setThemeState] = useState<Theme>(() => resolveTheme());
  const [navOpen, setNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  // Back to a household invite that was opened before signing in (KAN-77).
  useEffect(() => {
    if (readPendingInvite()) navigate('/household/join', { replace: true });
  }, [navigate]);
  const [metalProvider, setMetalProvider] = useState<string | null>(null);
  const moneyHidden = useMoneyHidden();
  const outlet = useOutlet();
  const routed = children ?? outlet;
  const painted = isValidElement(routed)
    ? cloneElement(routed, { moneyHidden } as { moneyHidden: boolean })
    : routed;
  const visibleLinks = links.filter((l) => {
    if (l.visible) return l.visible(enabled, valueSearch);
    if (l.requirePref) return enabled(l.requirePref);
    return true;
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => schedulePrefetchAppRoutes(), []);

  useEffect(() => {
    let cancelled = false;
    api.quotes
      .metalsStatus()
      .then((status) => {
        if (!cancelled) setMetalProvider(status.provider);
      })
      .catch(() => {
        if (!cancelled) setMetalProvider(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      const nav = document.getElementById(MOBILE_NAV_ID);
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

  // The drawer is for phones: close it if the window widens to the desktop layout.
  useEffect(() => {
    if (!navOpen || typeof window.matchMedia !== 'function') return;
    const desktop = window.matchMedia('(min-width: 769px)');
    const onChange = () => {
      if (desktop.matches) setNavOpen(false);
    };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
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

  const closeNav = () => setNavOpen(false);

  // Hide-amounts and theme controls: in the header, and again at the bottom of the phone drawer.
  const tools = (
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
  );

  return (
    <div className={'app-shell' + (navOpen ? ' nav-drawer-open' : '')}>
      <header className="app-header">
        <div className="brand">
          <ProfileMenu triggerClassName="brand-mark" />
          <h1 className="brand-title">
            <BrandLockup size="sm" />
          </h1>
        </div>
        {/* Desktop nav pill. Phones use MobileNavDrawer (this nav is hidden at 768px and below). */}
        <nav id="app-primary-nav" className="nav">
          {visibleLinks.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              onClick={closeNav}
              onMouseEnter={() => prefetchNavTarget(l.to)}
              onFocus={() => prefetchNavTarget(l.to)}
              onTouchStart={() => prefetchNavTarget(l.to)}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          {tools}
          <button
            ref={menuButtonRef}
            type="button"
            className="nav-toggle"
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navOpen}
            aria-controls={MOBILE_NAV_ID}
            onClick={() => setNavOpen((o) => !o)}
          >
            {navOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </header>
      <MobileNavDrawer open={navOpen} onClose={closeNav} links={visibleLinks} tools={tools} returnFocusRef={menuButtonRef} />
      <main className="app-main">
        <MoneyHiddenProvider>
          <Suspense fallback={<div className="panel"><p className="muted">Loading…</p></div>}>
            {painted}
          </Suspense>
        </MoneyHiddenProvider>
      </main>
      <QuietToast />
      <PageAds />
      {/* Dashboard carries this note behind its net worth ⓘ; Portfolio, Debts, Warranties and Rentals drop it. */}
      {FOOTERLESS_PATHS.has(location.pathname) ? null : (
        <footer className="app-footer">
          {legalOnlyFooter(location.pathname, location.search) ? null : <>{metalProviderFooter(metalProvider)} · sync failures stay quiet ·{' '}</>}
          <Link to="/privacy">Privacy policy</Link> · <Link to="/terms">Terms of use</Link>
        </footer>
      )}
    </div>
  );
}
