import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { apiFetch, buildQuery } from '../api/client';

/* ------------------------------------------------------------------ */
/* Global activity counter (drives the 2 px progress bar under the top bar) */
/* ------------------------------------------------------------------ */

let activeCount = 0;
const listeners = new Set();

function emit() {
  listeners.forEach((l) => l());
}

/** Increment the global activity counter; returns a function that decrements it (idempotent). */
export function beginActivity() {
  activeCount += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    activeCount = Math.max(0, activeCount - 1);
    emit();
  };
}

/** Wrap any promise (e.g. a mutation) so it shows the top progress bar while pending. */
export function trackActivity(promise) {
  const end = beginActivity();
  return Promise.resolve(promise).finally(end);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useGlobalActivity() -> number of in-flight tracked requests (truthy = show progress bar). */
export function useGlobalActivity() {
  return useSyncExternalStore(subscribe, () => activeCount, () => 0);
}

/* ------------------------------------------------------------------ */
/* useApi                                                              */
/* ------------------------------------------------------------------ */

/**
 * useApi(pathOrNull, { query, deps = [], keepPrevious = true, silent = false })
 *   -> { data, error, loading, refreshing, reload(opts?), setData }
 *
 * - pathOrNull: "/api/flags" or null to skip fetching (e.g. until an id is known).
 * - query: object turned into a query string (arrays repeat, empty values skipped);
 *   a change in query (by value) refetches.
 * - deps: extra values that trigger a refetch when they change.
 * - keepPrevious: keep showing the previous data while a new request loads
 *   (then `refreshing` is true and `loading` false). With false, data resets to null.
 * - silent: don't drive the global progress bar (use for background polling).
 * - loading: true only while there is no data yet. refreshing: request in flight with data shown.
 * - reload({ silent }) refetches the current request and resolves with the new data
 *   (or undefined on error). Errors are stored in `error` (Error with .status/.detail).
 * - setData(value | fn) for optimistic updates.
 */
export default function useApi(path, options = {}) {
  const { query, deps = [], keepPrevious = true, silent = false } = options;
  const key = path ? `${path}${buildQuery(query)}` : null;

  const [state, setState] = useState(() => ({
    data: null,
    error: null,
    loading: !!key,
    refreshing: false,
  }));
  const [nonce, setNonce] = useState(0);

  const reqIdRef = useRef(0);
  const controllerRef = useRef(null);
  const pendingResolvers = useRef([]);
  const reloadOpts = useRef({});
  const silentRef = useRef(silent);
  silentRef.current = silent;
  const dataRef = useRef(null);
  dataRef.current = state.data;

  useEffect(() => {
    if (!key) {
      reloadOpts.current = {};
      const waiting = pendingResolvers.current;
      pendingResolvers.current = [];
      waiting.forEach((r) => r(undefined));
      setState((s) => ({ ...s, loading: false, refreshing: false }));
      return undefined;
    }
    const reqId = ++reqIdRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const opts = reloadOpts.current;
    reloadOpts.current = {};
    const quiet = opts.silent ?? silentRef.current;

    setState((s) => {
      const keep = keepPrevious || opts.isReload;
      const hasData = keep && s.data !== null && s.data !== undefined;
      return {
        data: keep ? s.data : null,
        error: null,
        loading: !hasData,
        refreshing: hasData && !quiet,
      };
    });

    const end = quiet ? () => {} : beginActivity();
    const resolvers = pendingResolvers.current;
    pendingResolvers.current = [];

    apiFetch(key, { signal: controller.signal })
      .then((data) => {
        if (reqId !== reqIdRef.current) return;
        setState({ data, error: null, loading: false, refreshing: false });
        resolvers.forEach((r) => r(data));
      })
      .catch((error) => {
        if (error?.name === 'AbortError') {
          resolvers.forEach((r) => r(undefined));
          return;
        }
        if (reqId !== reqIdRef.current) return;
        setState((s) => ({ ...s, error, loading: false, refreshing: false }));
        resolvers.forEach((r) => r(undefined));
      })
      .finally(end);

    return () => {
      controller.abort();
      end();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, keepPrevious, ...deps]);

  const reload = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      pendingResolvers.current.push(resolve);
      reloadOpts.current = { ...opts, isReload: true };
      setNonce((n) => n + 1);
    });
  }, []);

  const setData = useCallback((next) => {
    setState((s) => ({ ...s, data: typeof next === 'function' ? next(s.data) : next }));
  }, []);

  return { ...state, reload, setData };
}

// Named export too, so both import styles work.
export { useApi };
