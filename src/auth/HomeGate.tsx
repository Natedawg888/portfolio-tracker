import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Home } from '../pages/Home';

/**
 * Signed-out visitors at "/" get the public home page. Everything else (signed-in
 * users, every other route, and "/" while the session is still being checked)
 * falls through to the existing routes and RequireAuth, unchanged.
 */
export function HomeGate() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  if (!loading && !user && pathname === '/') return <Home />;
  return <Outlet />;
}
