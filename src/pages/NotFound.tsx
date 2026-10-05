import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Layout } from '../components/Layout';

function NotFoundMessage({ signedIn }: { signedIn: boolean }) {
  return (
    <section className={signedIn ? 'panel not-found-panel' : 'auth-card panel not-found-panel'}>
      <p className="eyebrow">Portfolio Tracker</p>
      <h2 className="page-title">Page not found</h2>
      <p className="page-lead">That address is not a page in this app.</p>
      <div className="row gap">
        <Link to={signedIn ? '/' : '/login'} className="btn primary">
          {signedIn ? 'Back home' : 'Back to sign in'}
        </Link>
      </div>
    </section>
  );
}

export function NotFoundRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card panel">
          <p className="muted">Checking session…</p>
        </div>
      </div>
    );
  }

  if (user?.onboardingComplete) {
    return (
      <Layout>
        <div className="stack">
          <NotFoundMessage signedIn />
        </div>
      </Layout>
    );
  }

  return (
    <div className="auth-page">
      <NotFoundMessage signedIn={false} />
    </div>
  );
}
