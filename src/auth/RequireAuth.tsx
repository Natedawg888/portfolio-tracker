import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireAuth() {
  const { user, loading, status } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card panel">
          <p className="muted">Checking session…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    if (status?.needsSetup) {
      return <Navigate to="/register" replace state={{ from: location }} />;
    }
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Block dashboard / app until required signup steps are done.
  if (!user.onboardingComplete) {
    return <Navigate to="/register" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
