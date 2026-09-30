import { lazy, Suspense } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import Layout from './components/Layout';
import RequireAuth from './auth/RequireAuth';
import LoginPage from './pages/LoginPage';
import { Button, EmptyState, Skeleton, SkeletonRows } from './components/ui';
import useDocumentTitle from './hooks/useDocumentTitle';

// Pages are code-split so recharts / leaflet only load where they are used.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const FlagQueuePage = lazy(() => import('./pages/FlagQueuePage'));
const FlagDetailPage = lazy(() => import('./pages/FlagDetailPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const CustomerPage = lazy(() => import('./pages/CustomerPage'));
const NetworkPage = lazy(() => import('./pages/NetworkPage'));
const RulesPage = lazy(() => import('./pages/RulesPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const DataPage = lazy(() => import('./pages/DataPage'));

/** Shown inside the shell while a page chunk loads. */
function PageFallback() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading page">
      <div className="stack stack-sm">
        <Skeleton width={220} height={28} />
        <Skeleton width={360} height={16} />
      </div>
      <SkeletonRows rows={6} columns={5} />
    </div>
  );
}

function page(Component) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Component />
    </Suspense>
  );
}

function adminPage(Component) {
  return <RequireAuth roles={['ADMIN']}>{page(Component)}</RequireAuth>;
}

function NotFoundPage() {
  const navigate = useNavigate();
  useDocumentTitle('Page not found');
  return (
    <div className="page-center">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={
          <Button variant="primary" onClick={() => navigate('/')}>
            Go to dashboard
          </Button>
        }
      />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={page(DashboardPage)} />
        <Route path="flags" element={page(FlagQueuePage)} />
        <Route path="flags/:id" element={page(FlagDetailPage)} />
        <Route path="transactions" element={page(TransactionsPage)} />
        <Route path="customers/:customerId" element={page(CustomerPage)} />
        <Route path="network" element={page(NetworkPage)} />
        <Route path="rules" element={page(RulesPage)} />
        <Route path="alerts" element={adminPage(AlertsPage)} />
        <Route path="audit" element={adminPage(AuditPage)} />
        <Route path="data" element={adminPage(DataPage)} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
