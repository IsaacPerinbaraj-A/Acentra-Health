/**
 * API client (plan Section 15.1).
 *
 * apiFetch(path, { method = 'GET', body, formData, query, signal, headers, skipAuthRedirect })
 *   - adds "Authorization: Bearer <token>" from localStorage
 *   - body -> JSON; formData -> multipart (no Content-Type header, browser sets boundary)
 *   - query -> "?a=1&b=x&b=y" (arrays repeat, null/undefined/'' skipped)
 *   - resolves with parsed JSON (null for 204/empty bodies)
 *   - rejects with ApiError (extends Error): .message readable text, .status, .detail (raw)
 *     422 detail arrays are flattened: "amount: Input should be greater than 0; …"
 *   - on 401 (except the login call): clears the token and redirects to /login?next=<current path>
 *     (pass skipAuthRedirect: true to handle 401 yourself)
 */

export const TOKEN_KEY = 'risklens.token';

export function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function clearToken() {
  setToken(null);
}

export class ApiError extends Error {
  constructor(message, { status = 0, detail = null, data = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.data = data;
  }
}

/** { a: 1, b: ['x', 'y'], c: '', d: null } -> "?a=1&b=x&b=y" ('' when nothing to add). */
export function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((v) => {
        if (v !== undefined && v !== null && v !== '') params.append(key, String(v));
      });
    } else if (typeof value === 'boolean') {
      params.append(key, value ? 'true' : 'false');
    } else {
      params.append(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function withQuery(path, query) {
  const q = buildQuery(query);
  if (!q) return path;
  return path.includes('?') ? `${path}&${q.slice(1)}` : `${path}${q}`;
}

/** Turn FastAPI's {"detail": ...} into a readable sentence. */
export function formatDetail(detail, status) {
  if (detail === null || detail === undefined || detail === '') {
    return status ? `Request failed (${status})` : 'Request failed';
  }
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((d) => {
      if (typeof d === 'string') return d;
      const loc = Array.isArray(d?.loc) ? d.loc.filter((p) => p !== 'body' && p !== 'query' && p !== 'path') : [];
      const msg = d?.msg || JSON.stringify(d);
      return loc.length ? `${loc.join('.')}: ${msg}` : msg;
    });
    return parts.join('; ') || `Request failed (${status})`;
  }
  if (typeof detail === 'object') {
    if (detail.message) return String(detail.message);
    try {
      return JSON.stringify(detail);
    } catch {
      return `Request failed (${status})`;
    }
  }
  return String(detail);
}

let redirecting = false;

function redirectToLogin() {
  if (redirecting) return;
  const { pathname, search } = window.location;
  if (pathname === '/login') return;
  redirecting = true;
  const next = encodeURIComponent(`${pathname}${search}`);
  window.location.assign(`/login?next=${next}`);
}

export async function apiFetch(path, options = {}) {
  const { method = 'GET', body, formData, query, signal, headers = {}, skipAuthRedirect = false } = options;
  const url = withQuery(path, query);
  const h = { Accept: 'application/json', ...headers };
  const token = getToken();
  if (token && !h.Authorization) h.Authorization = `Bearer ${token}`;

  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, { method, headers: h, body: payload, signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError("Can't reach the server. Check that the backend is running on port 8000.", {
      status: 0,
    });
  }

  let data = null;
  const text = res.status === 204 ? '' : await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : null;
    const isLogin = path.startsWith('/api/auth/login');
    if (res.status === 401 && !isLogin) {
      clearToken();
      if (!skipAuthRedirect) redirectToLogin();
    }
    let message = formatDetail(detail, res.status);
    if (!detail) {
      if (res.status === 401) message = 'Your session has expired. Please sign in again.';
      else if (res.status === 403) message = "You don't have permission to do that.";
      else if (res.status === 404) message = 'Not found.';
      else if (res.status >= 500) message = `Server error (${res.status}). Try again in a moment.`;
    }
    throw new ApiError(message, { status: res.status, detail, data });
  }

  return data;
}

/** Shorthands: api.get(path, query), api.post(path, body), api.patch(path, body), api.upload(path, formData). */
export const api = {
  get: (path, query, opts = {}) => apiFetch(path, { ...opts, query }),
  post: (path, body, opts = {}) => apiFetch(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts = {}) => apiFetch(path, { ...opts, method: 'PATCH', body }),
  put: (path, body, opts = {}) => apiFetch(path, { ...opts, method: 'PUT', body }),
  del: (path, opts = {}) => apiFetch(path, { ...opts, method: 'DELETE' }),
  upload: (path, formData, opts = {}) => apiFetch(path, { ...opts, method: 'POST', formData }),
};

export default apiFetch;
