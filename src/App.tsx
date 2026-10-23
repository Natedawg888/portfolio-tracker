
import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Privacy } from './pages/Privacy';
import { Terms } from './pages/Terms';
import { ConfirmEmail } from './pages/ConfirmEmail';
import { HouseholdJoin } from './pages/HouseholdJoin';
import { NotFoundRoute } from './pages/NotFound';
import {
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
  CalendarPage,
  InvoicesPage,
  InvoiceEditorPage,
  InvoiceDetailPage,
  PublicInvoicePage,
  BillsPage,
  WarrantiesPage,
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
import { AuthProvider } from './auth/AuthContext';
import { AssetClassPrefsProvider } from './auth/AssetClassPrefsContext';
import { RequireAuth } from './auth/RequireAuth';
import { HomeGate } from './auth/HomeGate';
import './App.css';

/** Invoices moved under Business (KAN-84): /invoices/… → /business/invoices/…, keeping the query. */
function InvoicesMoved() {
  const { pathname, search, hash } = useLocation();
  return <Navigate replace to={`/business${pathname}${search}${hash}`} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AssetClassPrefsProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            {/* Privacy policy and terms of use (KAN-14): public, no ads. */}
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            {/* Household invite links work before signing in (KAN-77). */}
            <Route path="/household/join" element={<HouseholdJoin />} />
            {/* Email change link: works on any device, signed in or not. */}
            <Route path="/confirm-email" element={<ConfirmEmail />} />
            <Route
              path="/i/:token"
              element={
                <Suspense fallback={null}>
                  <PublicInvoicePage />
                </Suspense>
              }
            />
            {/* Signed out at "/": public home page. Otherwise the app as before. */}
            <Route element={<HomeGate />}>
              <Route element={<RequireAuth />}>
                <Route element={<Layout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="spending" element={<SpendingPage />} />
                  {/* Bills & subscriptions: opened from Budget, not in the nav bar (KAN-27). */}
                  <Route path="bills" element={<BillsPage />} />
                  {/* Warranties: opened from Budget, not in the nav bar (KAN-61). */}
                  <Route path="warranties" element={<WarrantiesPage />} />
                  <Route path="rentals" element={<RentalsPage />} />
                  <Route path="payslips" element={<PayslipsPage />} />
                  <Route path="vehicles" element={<VehiclesPage />} />
                  <Route path="crypto" element={<CryptoPage />} />
                  <Route path="shopping" element={<ShoppingListsPage />} />
                  <Route path="household" element={<HouseholdPage />} />
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
                  <Route path="business/:id" element={<BusinessDetailPage />} />
                  <Route path="invoices/*" element={<InvoicesMoved />} />
                  <Route path="value-search" element={<ValueSearchPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<NotFoundRoute />} />
          </Routes>
        </BrowserRouter>
      </AssetClassPrefsProvider>
    </AuthProvider>
  );
}
