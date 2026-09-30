import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Button, EmptyState, Spinner } from '../components/ui';
import useDocumentTitle from '../hooks/useDocumentTitle';

/** Full-screen placeholder while the session is restored from the stored token. */
export function AuthLoading({ label = 'Restoring your session…' }) {
  return (
    <div className="app-loading" role="status" aria-live="polite">
      <Spinner size={24} />
      <span className="app-loading-label">{label}</span>
    </div>
  );
}

function NoAccess() {
  const navigate = useNavigate();
  useDocumentTitle('No access');
  return (
    <div className="page-center">
      <EmptyState
        icon={Lock}
        title="You don't have access to this page"
        description="Your role doesn't include this area of RiskLens. Ask an administrator if you need access."
        action={
          <Button variant="secondary" onClick={() => navigate('/', { replace: true })}>
            Go to dashboard
          </Button>
        }
      />
    </div>
  );
}

/**
 * <RequireAuth>…</RequireAuth>                 logged-in users only (redirects to /login, remembering the page)
 * <RequireAuth roles={['ADMIN']}>…</RequireAuth> role-restricted; wrong role -> "no access" empty state
 */
export function RequireAuth({ roles, children }) {
  const { user, loading, hasRole } = useAuth();
  const location = useLocation();

  if (loading) return <AuthLoading />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (roles && roles.length > 0 && !hasRole(...roles)) {
    return <NoAccess />;
  }

  return children;
}

export default RequireAuth;
