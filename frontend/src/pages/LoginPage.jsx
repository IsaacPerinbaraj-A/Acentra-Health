import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, BellRing, Eye, EyeOff, ListChecks, LogIn, Moon, Network, Sun } from 'lucide-react';
import { useAuth, ROLE_LABELS } from '../auth/AuthContext';
import { AuthLoading } from '../auth/RequireAuth';
import { useTheme } from '../theme/ThemeContext';
import { Avatar, Button, IconButton, Input, Pill } from '../components/ui';
import Logo from '../components/Logo';
import useDocumentTitle from '../hooks/useDocumentTitle';
import '../styles/pages/login.css';

const IS_DEV = Boolean(import.meta.env.DEV);

const DEMO_ACCOUNTS = [
  { username: 'admin', role: 'ADMIN', password: 'admin123', tone: 'brand', note: 'Everything, incl. rules & data' },
  { username: 'reviewer', role: 'REVIEWER', password: 'reviewer123', tone: 'info', note: 'Review flags, add notes' },
  { username: 'viewer', role: 'VIEWER', password: 'viewer123', tone: 'neutral', note: 'Read-only access' },
];

const VALUE_POINTS = [
  {
    icon: ListChecks,
    title: 'Explainable rules',
    text: 'Every flag shows which rules fired, the points they added and the evidence behind them.',
  },
  {
    icon: BellRing,
    title: 'Real-time alerts',
    text: 'High and critical risk transactions reach reviewers the moment they are scored.',
  },
  {
    icon: Network,
    title: 'Fraud ring detection',
    text: 'Shared devices reveal linked accounts so rings are caught together, not one by one.',
  },
];

/** Only same-origin app paths are allowed as a post-login destination. */
function safePath(p) {
  if (typeof p !== 'string') return null;
  if (!p.startsWith('/') || p.startsWith('//') || p.startsWith('/login')) return null;
  return p;
}

function useRedirectTarget() {
  const location = useLocation();
  const from = location.state?.from;
  if (from && typeof from === 'object') {
    const p = safePath(`${from.pathname || ''}${from.search || ''}${from.hash || ''}`);
    if (p) return p;
  }
  const next = new URLSearchParams(location.search).get('next');
  return safePath(next) || '/';
}

export default function LoginPage() {
  useDocumentTitle('Sign in');
  const { user, loading, login } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const target = useRedirectTarget();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (loading) return <AuthLoading />;
  if (user && !submitting) return <Navigate to={target} replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const u = username.trim();
    if (!u || !password) {
      setError('Enter your username and password.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await login(u, password);
      navigate(target, { replace: true });
    } catch (err) {
      if (err?.status === 401) setError('Incorrect username or password.');
      else setError(err?.message || 'Sign-in failed. Please try again.');
      setSubmitting(false);
    }
  };

  const fillDemo = (acc) => {
    setUsername(acc.username);
    setError('');
    if (IS_DEV) {
      setPassword(acc.password);
    } else {
      setPassword('');
      window.requestAnimationFrame(() => document.getElementById('login-password')?.focus());
    }
  };

  return (
    <div className="login">
      <aside className="login-hero" aria-label="About RiskLens">
        <div className="login-hero-inner">
          <Logo variant="inverse" size={40} withWordmark className="login-hero-logo" />
          <div className="login-hero-copy">
            <h2 className="login-hero-title">Explainable fraud screening</h2>
            <p className="login-hero-lead">
              Screen every payment, see exactly why it was flagged and decide with confidence.
            </p>
          </div>
          <ul className="login-points">
            {VALUE_POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="login-point">
                <span className="login-point-icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <span className="login-point-body">
                  <span className="login-point-title">{title}</span>
                  <span className="login-point-text">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="login-hero-foot">Explainable rules · Real-time alerts · Fraud ring detection</p>
        </div>
      </aside>

      <main className="login-main">
        <div className="login-toolbar">
          <IconButton
            icon={isDark ? Sun : Moon}
            label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleTheme}
          />
        </div>

        <div className="login-column">
          <div className="login-mobile-brand">
            <Logo size={32} withWordmark />
            <span className="login-mobile-tagline">Explainable fraud screening</span>
          </div>

          <section className="login-card" aria-labelledby="login-title">
            <header className="login-card-header">
              <h1 id="login-title" className="login-card-title">
                Sign in to RiskLens
              </h1>
              <p className="login-card-sub">Use your fraud operations account to continue.</p>
            </header>

            <form className="login-form" onSubmit={onSubmit} noValidate>
              <Input
                id="login-username"
                label="Username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
                aria-invalid={error ? 'true' : undefined}
              />

              <div className="login-password">
                <Input
                  id="login-password"
                  label="Password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  aria-invalid={error ? 'true' : undefined}
                  style={{ paddingRight: 'calc(var(--control-h) + var(--space-1))' }}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                >
                  {showPassword ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
                </button>
              </div>

              {error && (
                <div className="login-error" role="alert">
                  <AlertCircle size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" variant="primary" icon={LogIn} loading={submitting} fullWidth>
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </section>

          <section className="login-demo" aria-labelledby="login-demo-title">
            <div className="login-demo-header">
              <h2 id="login-demo-title" className="login-demo-title">
                Demo accounts
              </h2>
              <span className="login-demo-hint">Click to fill the form</span>
            </div>
            <ul className="login-demo-list">
              {DEMO_ACCOUNTS.map((acc) => (
                <li key={acc.username}>
                  <button
                    type="button"
                    className="login-demo-row"
                    onClick={() => fillDemo(acc)}
                    disabled={submitting}
                    aria-label={`Fill the form with the ${ROLE_LABELS[acc.role] || acc.role} demo account (${acc.username})`}
                  >
                    <Avatar name={acc.username} size={28} />
                    <span className="login-demo-id">
                      <span className="login-demo-user mono">{acc.username}</span>
                      <span className="login-demo-note">{acc.note}</span>
                    </span>
                    {IS_DEV && <span className="login-demo-pass mono">{acc.password}</span>}
                    <Pill tone={acc.tone}>{ROLE_LABELS[acc.role] || acc.role}</Pill>
                  </button>
                </li>
              ))}
            </ul>
            {!IS_DEV && <p className="login-demo-foot">Passwords are listed in the project README.</p>}
          </section>
        </div>
      </main>
    </div>
  );
}
