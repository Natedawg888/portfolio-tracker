
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { NotFoundRoute } from './pages/NotFound';
import {
  DebtsPage,
  EconomicCyclePage,
  KiwiSaverPage,
  PayePage,
  PortfolioPage,
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
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="spending" element={<SpendingPage />} />
                <Route path="debts" element={<DebtsPage />} />
                <Route path="yearly" element={<YearlyReportPage />} />
                <Route path="economic-cycle" element={<EconomicCyclePage />} />
                <Route path="portfolio" element={<PortfolioPage />} />
                <Route path="kiwisaver" element={<KiwiSaverPage />} />
                <Route path="paye" element={<PayePage />} />
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
