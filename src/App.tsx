
import { Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Privacy } from './pages/Privacy';
import { NotFoundRoute } from './pages/NotFound';
import {
  DebtsPage,
  EconomicCyclePage,
  KiwiSaverPage,
  NewsPage,
  PayePage,
  InvoicesPage,
  InvoiceEditorPage,
  InvoiceDetailPage,
  PublicInvoicePage,
  BillsPage,
  WarrantiesPage,
  RentalsPage,
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
import './App.css';

export default function App() {
  return (
    <AuthProvider>
      <AssetClassPrefsProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            {/* Privacy (advertising section, KAN-72): public, no ads. */}
            <Route path="/privacy" element={<Privacy />} />
            <Route
              path="/i/:token"
              element={
                <Suspense fallback={null}>
                  <PublicInvoicePage />
                </Suspense>
              }
            />
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="spending" element={<SpendingPage />} />
                {/* Bills & subscriptions: opened from Budget, not in the nav bar (KAN-27). */}
                <Route path="bills" element={<BillsPage />} />
                {/* Warranties: opened from Budget, not in the nav bar (KAN-61). */}
                <Route path="warranties" element={<WarrantiesPage />} />
                <Route path="rentals" element={<RentalsPage />} />
                <Route path="debts" element={<DebtsPage />} />
                <Route path="yearly" element={<YearlyReportPage />} />
                <Route path="economic-cycle" element={<EconomicCyclePage />} />
                <Route path="portfolio" element={<PortfolioPage />} />
                <Route path="projections" element={<ProjectionsPage />} />
                <Route path="news" element={<NewsPage />} />
                <Route path="kiwisaver" element={<KiwiSaverPage />} />
                <Route path="paye" element={<PayePage />} />
                <Route path="invoices" element={<InvoicesPage />} />
                <Route path="invoices/new" element={<InvoiceEditorPage />} />
                <Route path="invoices/:id" element={<InvoiceDetailPage />} />
                <Route path="invoices/:id/edit" element={<InvoiceEditorPage />} />
                <Route path="value-search" element={<ValueSearchPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFoundRoute />} />
          </Routes>
        </BrowserRouter>
      </AssetClassPrefsProvider>
    </AuthProvider>
  );
}
