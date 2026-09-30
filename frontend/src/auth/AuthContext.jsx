import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, clearToken, getToken, setToken, TOKEN_KEY } from '../api/client';

/**
 * AuthProvider (must be inside <BrowserRouter>).
 * useAuth() -> {
 *   user: {id, username, role} | null,
 *   loading: true while restoring the session via GET /api/auth/me,
 *   login(username, password) -> Promise<user> (throws ApiError with a readable message on 401),
 *   logout() -> clears token, navigates to /login,
 *   hasRole(...roles) -> boolean  (hasRole('ADMIN'), hasRole('REVIEWER', 'ADMIN'), hasRole(['ADMIN']))
 *   isAdmin, canReview (REVIEWER or ADMIN), refreshUser()
 * }
 */

export const ROLES = { ADMIN: 'ADMIN', REVIEWER: 'REVIEWER', VIEWER: 'VIEWER' };
export const ROLE_LABELS = { ADMIN: 'Admin', REVIEWER: 'Reviewer', VIEWER: 'Viewer' };

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!getToken());

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return null;
    }
    try {
      const me = await apiFetch('/api/auth/me', { skipAuthRedirect: true });
      setUser(me);
      return me;
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        clearToken();
        setUser(null);
      }
      throw err;
    }
  }, []);

  // Restore the session on reload
  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      setLoading(false);
      return undefined;
    }
    apiFetch('/api/auth/me', { skipAuthRedirect: true })
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch((err) => {
        if (cancelled) return;
        // Only forget the token when the server rejected it; keep it on network errors.
        if (err?.status === 401 || err?.status === 403) clearToken();
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Logging out in another tab logs out here too
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === TOKEN_KEY && !e.newValue) setUser(null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    setToken(res.access_token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const hasRole = useCallback(
    (...roles) => {
      if (!user) return false;
      const list = roles.flat().filter(Boolean);
      return list.length === 0 || list.includes(user.role);
    },
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      hasRole,
      refreshUser,
      isAdmin: user?.role === ROLES.ADMIN,
      canReview: user?.role === ROLES.ADMIN || user?.role === ROLES.REVIEWER,
    }),
    [user, loading, login, logout, hasRole, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export default AuthContext;
