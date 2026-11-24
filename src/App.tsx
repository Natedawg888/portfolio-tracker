
import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomeRoute } from './components/HomeRoute';
import { NotFoundRoute } from './pages/NotFound';
import {
  DashboardPage,
  LoginPage,
  RegisterPage,
  PrivacyPage,
  TermsPage,
  ConfirmEmailPage,
  RecoverPage,
  BusinessJoinPage,
  HouseholdJoinPage,
  DebtsPage,
  EconomicCyclePage,
  KiwiSaverPage,
  NewsPage,
  PayePage,
  BusinessPage,
  BusinessDetailPage,
  BusinessClientsPage,
  BusinessStockPage,
  BusinessProfitLossPage,
  BusinessGstPage,
  BusinessSalesPage,
  BusinessSuppliersPage,
  BusinessBudgetPage,
  CalendarPage,
  InvoicesPage,
  InvoiceEditorPage,
  InvoiceDetailPage,
  PublicInvoicePage,
  BillsPage,
  WarrantiesPage,
  DonationsPage,
  AlertsPage,
  TimelinePage,
  RentalsPage,
  PayslipsPage,
  VehiclesPage,
  CryptoPage,
  ShoppingListsPage,
  HouseholdPage,
  PortfolioPage,
  ProjectionsPage,
  SettingsPage,
  SpendingPage,
  ValueSearchPage,
  YearlyReportPage,
} from './lib/routePrefetch';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { homePathForMode, offersHousehold } from './lib/usageMode';
import { AssetClassPrefsProvider } from './auth/AssetClassPrefsContext';
import { RequireAuth } from './auth/RequireAuth';
import { HomeGate } from './auth/HomeGate';
import './App.css';

/** Invoices moved under Business (KAN-84): /invoices/… → /business/invoices/…, keeping the query. */
/** Households are personal: a Business-only account is sent home (KAN-133). */
function HouseholdRoute() {
  const { user } = useAuth();
  if (user && !offersHousehold(user.usageMode)) return <Navigate to={homePathForMode(user.usageMode)} replace />;
  return <HouseholdPage />;
}

function InvoicesMoved() {
  const { pathname, search, hash } = useLocation();
  return <Navigate replace to={`/business${pathname}${search}${hash}`} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AssetClassPrefsProvider>
        <BrowserRouter>
          {/* Signed-out pages load on demand; pages inside Layout have its own Loading… boundary. */}
          <Suspense fallback={null}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              {/* Privacy policy and terms of use (KAN-14): public, no ads. */}
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              {/* Household invite links work before signing in (KAN-77). */}
              <Route path="/household/join" element={<HouseholdJoinPage />} />
              <Route path="/business/join" element={<BusinessJoinPage />} />
              {/* Email change link: works on any device, signed in or not. */}
              <Route path="/confirm-email" element={<ConfirmEmailPage />} />
              {/* Forgotten password with the recovery code (KAN-111/117). */}
              <Route path="/recover" element={<RecoverPage />} />
              <Route path="/i/:token" element={<PublicInvoicePage />} />
              {/* Signed out at "/": public home page. Otherwise the app as before. */}
              <Route element={<HomeGate />}>
                <Route element={<RequireAuth />}>
                  <Route element={<Layout />}>
                    <Route index element={<HomeRoute />} />
                    {/* The Dashboard by address too, for Business only accounts whose "/" is the business dashboard. */}
                    <Route path="dashboard" element={<DashboardPage />} />
                    <Route path="spending" element={<SpendingPage />} />
                    {/* Bills & subscriptions: opened from Budget, not in the nav bar (KAN-27). */}
                    <Route path="bills" element={<BillsPage />} />
                    {/* Warranties: opened from Budget, not in the nav bar (KAN-61). */}
                    <Route path="warranties" element={<WarrantiesPage />} />
                    {/* Donations: opened from Budget (KAN-25). */}
                    <Route path="donations" element={<DonationsPage />} />
                    <Route path="alerts" element={<AlertsPage />} />
                    {/* Financial timeline: opened from History (KAN-62). */}
                    <Route path="timeline" element={<TimelinePage />} />
                    <Route path="rentals" element={<RentalsPage />} />
                    <Route path="payslips" element={<PayslipsPage />} />
                    <Route path="vehicles" element={<VehiclesPage />} />
                    <Route path="crypto" element={<CryptoPage />} />
                    <Route path="shopping" element={<ShoppingListsPage />} />
                    <Route path="household" element={<HouseholdRoute />} />
                    <Route path="debts" element={<DebtsPage />} />
                    <Route path="yearly" element={<YearlyReportPage />} />
                    {/* Economic cycle is a tab on the PAYE page; the old address still works. */}
                    <Route path="economic-cycle" element={<Navigate replace to="/paye/economic-cycle" />} />
                    <Route path="portfolio" element={<PortfolioPage />} />
                    <Route path="projections" element={<ProjectionsPage />} />
                    <Route path="news" element={<NewsPage />} />
                    <Route path="kiwisaver" element={<KiwiSaverPage />} />
                    <Route path="paye" element={<PayePage />} />
                    <Route path="paye/economic-cycle" element={<EconomicCyclePage />} />
                    <Route path="business" element={<BusinessPage />} />
                    <Route path="business/invoices" element={<InvoicesPage />} />
                    <Route path="business/invoices/new" element={<InvoiceEditorPage />} />
                    <Route path="business/invoices/:id" element={<InvoiceDetailPage />} />
                    <Route path="business/invoices/:id/edit" element={<InvoiceEditorPage />} />
                    <Route path="business/clients" element={<BusinessClientsPage />} />
                    <Route path="business/clients/:clientId" element={<BusinessClientsPage />} />
                    <Route path="calendar" element={<CalendarPage />} />
                    <Route path="business/:id/stock" element={<BusinessStockPage />} />
                    <Route path="business/:id/profit-loss" element={<BusinessProfitLossPage />} />
                    <Route path="business/:id/gst" element={<BusinessGstPage />} />
                    <Route path="business/:id/sales" element={<BusinessSalesPage />} />
                    <Route path="business/:id/suppliers" element={<BusinessSuppliersPage />} />
                    <Route path="business/:id/budget" element={<BusinessBudgetPage />} />
                    <Route path="business/:id" element={<BusinessDetailPage />} />
                    <Route path="invoices/*" element={<InvoicesMoved />} />
                    <Route path="value-search" element={<ValueSearchPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<NotFoundRoute />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AssetClassPrefsProvider>
    </AuthProvider>
  );
}
