import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** Each page: its chunk loader and the named export it renders (the page's file name). */
const loaders = {
  dashboard: [() => import('../pages/Dashboard'), 'Dashboard'],
  spending: [() => import('../pages/Spending'), 'Spending'],
  debts: [() => import('../pages/Debts'), 'Debts'],
  yearly: [() => import('../pages/YearlyReport'), 'YearlyReport'],
  portfolio: [() => import('../pages/Portfolio'), 'Portfolio'],
  projections: [() => import('../pages/Projections'), 'Projections'],
  news: [() => import('../pages/News'), 'News'],
  kiwisaver: [() => import('../pages/KiwiSaver'), 'KiwiSaver'],
  paye: [() => import('../pages/Paye'), 'Paye'],
  business: [() => import('../pages/Business'), 'Business'],
  businessDetail: [() => import('../pages/BusinessDetail'), 'BusinessDetail'],
  businessClients: [() => import('../pages/BusinessClients'), 'BusinessClients'],
  businessStock: [() => import('../pages/BusinessStock'), 'BusinessStock'],
  businessProfitLoss: [() => import('../pages/BusinessProfitLoss'), 'BusinessProfitLoss'],
  businessGst: [() => import('../pages/BusinessGst'), 'BusinessGst'],
  businessSales: [() => import('../pages/BusinessSales'), 'BusinessSales'],
  businessSuppliers: [() => import('../pages/BusinessSuppliers'), 'BusinessSuppliers'],
  businessBudget: [() => import('../pages/BusinessBudget'), 'BusinessBudget'],
  calendar: [() => import('../pages/Calendar'), 'Calendar'],
  invoices: [() => import('../pages/Invoices'), 'Invoices'],
  invoiceEditor: [() => import('../pages/InvoiceEditor'), 'InvoiceEditor'],
  invoiceDetail: [() => import('../pages/InvoiceDetail'), 'InvoiceDetail'],
  publicInvoice: [() => import('../pages/PublicInvoice'), 'PublicInvoice'],
  bills: [() => import('../pages/Bills'), 'Bills'],
  warranties: [() => import('../pages/Warranties'), 'Warranties'],
  donations: [() => import('../pages/Donations'), 'Donations'],
  alerts: [() => import('../pages/Alerts'), 'Alerts'],
  timeline: [() => import('../pages/Timeline'), 'Timeline'],
  rentals: [() => import('../pages/Rentals'), 'Rentals'],
  payslips: [() => import('../pages/Payslips'), 'Payslips'],
  vehicles: [() => import('../pages/Vehicles'), 'Vehicles'],
  crypto: [() => import('../pages/Crypto'), 'Crypto'],
  shopping: [() => import('../pages/ShoppingLists'), 'ShoppingLists'],
  household: [() => import('../pages/Household'), 'Household'],
  valueSearch: [() => import('../pages/ValueSearch'), 'ValueSearch'],
  settings: [() => import('../pages/Settings'), 'Settings'],
  economicCycle: [() => import('../pages/EconomicCycle'), 'EconomicCycle'],
  login: [() => import('../pages/Login'), 'Login'],
  register: [() => import('../pages/Register'), 'Register'],
  privacy: [() => import('../pages/Privacy'), 'Privacy'],
  terms: [() => import('../pages/Terms'), 'Terms'],
  confirmEmail: [() => import('../pages/ConfirmEmail'), 'ConfirmEmail'],
  recover: [() => import('../pages/Recover'), 'Recover'],
  businessJoin: [() => import('../pages/BusinessJoin'), 'BusinessJoin'],
  householdJoin: [() => import('../pages/HouseholdJoin'), 'HouseholdJoin'],
} as const satisfies Record<string, readonly [() => Promise<unknown>, string]>;

export type PageName = keyof typeof loaders;

const started = new Set<PageName>();

function lazyNamed(name: PageName): LazyExoticComponent<ComponentType> {
  const [load, exportName] = loaders[name];
  return lazy(async () => {
    const component = ((await load()) as Record<string, ComponentType>)[exportName];
    if (!component) throw new Error(`Missing page export ${exportName}`);
    return { default: component };
  });
}

export const DashboardPage = lazyNamed('dashboard');
// Signed-out pages: rendered outside Layout, so App wraps them in its own Suspense.
export const LoginPage = lazyNamed('login');
export const RegisterPage = lazyNamed('register');
export const PrivacyPage = lazyNamed('privacy');
export const TermsPage = lazyNamed('terms');
export const ConfirmEmailPage = lazyNamed('confirmEmail');
export const RecoverPage = lazyNamed('recover');
export const BusinessJoinPage = lazyNamed('businessJoin');
export const HouseholdJoinPage = lazyNamed('householdJoin');

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
export const BusinessGstPage = lazyNamed('businessGst');
export const BusinessSalesPage = lazyNamed('businessSales');
export const BusinessSuppliersPage = lazyNamed('businessSuppliers');
export const BusinessBudgetPage = lazyNamed('businessBudget');
export const CalendarPage = lazyNamed('calendar');
export const InvoicesPage = lazyNamed('invoices');
export const InvoiceEditorPage = lazyNamed('invoiceEditor');
export const InvoiceDetailPage = lazyNamed('invoiceDetail');
export const PublicInvoicePage = lazyNamed('publicInvoice');
export const BillsPage = lazyNamed('bills');
export const WarrantiesPage = lazyNamed('warranties');
export const DonationsPage = lazyNamed('donations');
export const AlertsPage = lazyNamed('alerts');
export const TimelinePage = lazyNamed('timeline');
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
  '/dashboard': 'dashboard',
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
  '/donations': 'donations',
  '/alerts': 'alerts',
  '/timeline': 'timeline',
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
  void loaders[name][0]().catch(() => {
    started.delete(name);
  });
}

export function prefetchNavTarget(to: string): void {
  const path = to.split('?')[0] || '/';
  const name = NAV_PAGES[path];
  if (name) prefetchPage(name);
}

/** Pages only a signed-out visitor sees; a signed-in session never needs their chunks. */
const SIGNED_OUT_PAGES = new Set<PageName>(['login', 'register', 'confirmEmail', 'recover', 'businessJoin', 'householdJoin']);

export function prefetchAppRoutes(): void {
  (Object.keys(loaders) as PageName[]).forEach((name) => {
    if (!SIGNED_OUT_PAGES.has(name)) prefetchPage(name);
  });
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
