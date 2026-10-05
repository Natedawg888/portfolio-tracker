import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const loaders = {
  spending: () => import('../pages/Spending'),
  debts: () => import('../pages/Debts'),
  yearly: () => import('../pages/YearlyReport'),
  portfolio: () => import('../pages/Portfolio'),
  kiwisaver: () => import('../pages/KiwiSaver'),
  paye: () => import('../pages/Paye'),
  valueSearch: () => import('../pages/ValueSearch'),
  settings: () => import('../pages/Settings'),
  economicCycle: () => import('../pages/EconomicCycle'),
} as const;

type PageName = keyof typeof loaders;

const started = new Set<PageName>();

function lazyNamed(name: PageName): LazyExoticComponent<ComponentType> {
  return lazy(async () => {
    const mod = (await loaders[name]()) as Record<string, ComponentType>;
    const component = mod[exportName(name)];
    if (!component) throw new Error(`Missing page export ${exportName(name)}`);
    return { default: component };
  });
}

function exportName(name: PageName): string {
  switch (name) {
    case 'spending':
      return 'Spending';
    case 'debts':
      return 'Debts';
    case 'yearly':
      return 'YearlyReport';
    case 'portfolio':
      return 'Portfolio';
    case 'kiwisaver':
      return 'KiwiSaver';
    case 'paye':
      return 'Paye';
    case 'valueSearch':
      return 'ValueSearch';
    case 'settings':
      return 'Settings';
    case 'economicCycle':
      return 'EconomicCycle';
  }
}

export const SpendingPage = lazyNamed('spending');
export const DebtsPage = lazyNamed('debts');
export const YearlyReportPage = lazyNamed('yearly');
export const PortfolioPage = lazyNamed('portfolio');
export const KiwiSaverPage = lazyNamed('kiwisaver');
export const PayePage = lazyNamed('paye');
export const ValueSearchPage = lazyNamed('valueSearch');
export const SettingsPage = lazyNamed('settings');
export const EconomicCyclePage = lazyNamed('economicCycle');

const NAV_PAGES: Record<string, PageName> = {
  '/spending': 'spending',
  '/debts': 'debts',
  '/yearly': 'yearly',
  '/portfolio': 'portfolio',
  '/kiwisaver': 'kiwisaver',
  '/paye': 'paye',
  '/value-search': 'valueSearch',
  '/settings': 'settings',
  '/economic-cycle': 'economicCycle',
};

/** Start the dynamic import once. Safe to call from hover, focus, and idle. */
export function prefetchPage(name: PageName): void {
  if (started.has(name)) return;
  started.add(name);
  void loaders[name]().catch(() => {
    started.delete(name);
  });
}

export function prefetchNavTarget(to: string): void {
  const path = to.split('?')[0] || '/';
  const name = NAV_PAGES[path];
  if (name) prefetchPage(name);
}

export function prefetchAppRoutes(): void {
  (Object.keys(loaders) as PageName[]).forEach((name) => prefetchPage(name));
}

/** Warm route chunks after first paint so the first click does not wait on the network. */
export function schedulePrefetchAppRoutes(): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) prefetchAppRoutes();
  };
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof win.requestIdleCallback === 'function') {
    const id = win.requestIdleCallback(run, { timeout: 1500 });
    return () => {
      cancelled = true;
      win.cancelIdleCallback?.(id);
    };
  }
  const id = window.setTimeout(run, 300);
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}
