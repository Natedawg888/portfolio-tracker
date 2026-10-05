
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Spending } from './pages/Spending';
import { Debts } from './pages/Debts';
import { YearlyReport } from './pages/YearlyReport';
import { Portfolio } from './pages/Portfolio';
import { KiwiSaver } from './pages/KiwiSaver';
import { Paye } from './pages/Paye';
import { ValueSearch } from './pages/ValueSearch';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Settings } from './pages/Settings';
import { EconomicCycle } from './pages/EconomicCycle';
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
                <Route path="spending" element={<Spending />} />
                <Route path="debts" element={<Debts />} />
                <Route path="yearly" element={<YearlyReport />} />
                <Route path="economic-cycle" element={<EconomicCycle />} />
                <Route path="portfolio" element={<Portfolio />} />
                <Route path="kiwisaver" element={<KiwiSaver />} />
                <Route path="paye" element={<Paye />} />
                <Route path="value-search" element={<ValueSearch />} />
                <Route path="settings" element={<Settings />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AssetClassPrefsProvider>
    </AuthProvider>
  );
}
