import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const loaders = {
  spending: () => import('../pages/Spending'),
  debts: () => import('../pages/Debts'),
  yearly: () => import('../pages/YearlyReport'),
  portfolio: () => import('../pages/Portfolio'),
  projections: () => import('../pages/Projections'),
  news: () => import('../pages/News'),
  kiwisaver: () => import('../pages/KiwiSaver'),
  paye: () => import('../pages/Paye'),
  business: () => import('../pages/Business'),
  businessDetail: () => import('../pages/BusinessDetail'),
  businessClients: () => import('../pages/BusinessClients'),
  businessStock: () => import('../pages/BusinessStock'),
  businessProfitLoss: () => import('../pages/BusinessProfitLoss'),
  calendar: () => import('../pages/Calendar'),
  invoices: () => import('../pages/Invoices'),
  invoiceEditor: () => import('../pages/InvoiceEditor'),
  invoiceDetail: () => import('../pages/InvoiceDetail'),
  publicInvoice: () => import('../pages/PublicInvoice'),
  bills: () => import('../pages/Bills'),
  warranties: () => import('../pages/Warranties'),
  rentals: () => import('../pages/Rentals'),
  payslips: () => import('../pages/Payslips'),
  vehicles: () => import('../pages/Vehicles'),
  crypto: () => import('../pages/Crypto'),
  shopping: () => import('../pages/ShoppingLists'),
  household: () => import('../pages/Household'),
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
    case 'projections':
      return 'Projections';
    case 'news':
      return 'News';
    case 'kiwisaver':
      return 'KiwiSaver';
    case 'paye':
      return 'Paye';
    case 'business':
      return 'Business';
    case 'businessDetail':
      return 'BusinessDetail';
    case 'businessClients':
      return 'BusinessClients';
    case 'businessStock':
      return 'BusinessStock';
    case 'businessProfitLoss':
      return 'BusinessProfitLoss';
    case 'calendar':
      return 'Calendar';
    case 'invoices':
      return 'Invoices';
    case 'invoiceEditor':
      return 'InvoiceEditor';
    case 'invoiceDetail':
      return 'InvoiceDetail';
    case 'publicInvoice':
      return 'PublicInvoice';
    case 'bills':
      return 'Bills';
    case 'warranties':
      return 'Warranties';
    case 'rentals':
      return 'Rentals';
    case 'payslips':
      return 'Payslips';
    case 'vehicles':
      return 'Vehicles';
    case 'crypto':
      return 'Crypto';
    case 'shopping':
      return 'ShoppingLists';
    case 'household':
      return 'Household';
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
export const ProjectionsPage = lazyNamed('projections');
export const NewsPage = lazyNamed('news');
export const KiwiSaverPage = lazyNamed('kiwisaver');
export const PayePage = lazyNamed('paye');
export const BusinessPage = lazyNamed('business');
export const BusinessDetailPage = lazyNamed('businessDetail');
export const BusinessClientsPage = lazyNamed('businessClients');
export const BusinessStockPage = lazyNamed('businessStock');
export const BusinessProfitLossPage = lazyNamed('businessProfitLoss');
export const CalendarPage = lazyNamed('calendar');
export const InvoicesPage = lazyNamed('invoices');
export const InvoiceEditorPage = lazyNamed('invoiceEditor');
export const InvoiceDetailPage = lazyNamed('invoiceDetail');
export const PublicInvoicePage = lazyNamed('publicInvoice');
export const BillsPage = lazyNamed('bills');
export const WarrantiesPage = lazyNamed('warranties');
export const RentalsPage = lazyNamed('rentals');
export const PayslipsPage = lazyNamed('payslips');
export const VehiclesPage = lazyNamed('vehicles');
export const CryptoPage = lazyNamed('crypto');
export const ShoppingListsPage = lazyNamed('shopping');
export const HouseholdPage = lazyNamed('household');
export const ValueSearchPage = lazyNamed('valueSearch');
export const SettingsPage = lazyNamed('settings');
export const EconomicCyclePage = lazyNamed('economicCycle');

const NAV_PAGES: Record<string, PageName> = {
  '/spending': 'spending',
  '/debts': 'debts',
  '/yearly': 'yearly',
  '/portfolio': 'portfolio',
  '/projections': 'projections',
  '/news': 'news',
  '/kiwisaver': 'kiwisaver',
  '/paye': 'paye',
  '/business': 'business',
  '/business/invoices': 'invoices',
  '/business/clients': 'businessClients',
  '/calendar': 'calendar',
  '/bills': 'bills',
  '/warranties': 'warranties',
  '/rentals': 'rentals',
  '/payslips': 'payslips',
  '/vehicles': 'vehicles',
  '/crypto': 'crypto',
  '/shopping': 'shopping',
  '/household': 'household',
  '/value-search': 'valueSearch',
  '/settings': 'settings',
  '/paye/economic-cycle': 'economicCycle',
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
