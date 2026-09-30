import { useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useUrlState(defaults) -> [state, setState]
 *
 * Keeps filters in the URL query string (shareable, survives refresh).
 * The TYPE of each default decides how the param is parsed:
 *   array   -> repeatable param (?status=A&status=B)   e.g. { status: ['PENDING_REVIEW'] }
 *   number  -> Number (invalid -> default)              e.g. { page: 1, page_size: 25 }
 *   boolean -> "1"/"true" = true, "0"/"false" = false    e.g. { rings: false }
 *   string  -> as is                                     e.g. { q: '', sort: 'priority' }
 * Values equal to their default are removed from the URL (clean URLs). An empty array
 * whose default is non-empty is written as a single empty param (?status=) so "none" survives.
 *
 * setState(patch | (prev) => patch, { keepPage = false, push = false })
 *   - merges the patch; params not in `defaults` are preserved untouched
 *   - if `defaults` has `page` and the patch changes any other key without setting `page`,
 *     page resets to its default (filters changed -> back to page 1). keepPage: true disables that.
 *   - history is REPLACED (no back-button spam) unless push: true.
 * Also returns helpers on setState: setState.reset() resets all default keys.
 */
export default function useUrlState(defaults) {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const defaultsKey = JSON.stringify(defaults);

  const state = useMemo(() => {
    const d = defaultsRef.current;
    const out = {};
    for (const [key, def] of Object.entries(d)) {
      out[key] = parseParam(searchParams, key, def);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, defaultsKey]);

  const stateRef = useRef(state);
  stateRef.current = state;

  const setState = useCallback(
    (patchOrFn, opts = {}) => {
      const d = defaultsRef.current;
      setSearchParams(
        (prevParams) => {
          const prevState = {};
          for (const [key, def] of Object.entries(d)) prevState[key] = parseParam(prevParams, key, def);
          const patch = typeof patchOrFn === 'function' ? patchOrFn(prevState) : patchOrFn || {};
          const next = new URLSearchParams(prevParams);
          let changedOther = false;
          for (const [key, value] of Object.entries(patch)) {
            const def = key in d ? d[key] : undefined;
            if (key !== 'page' && !sameValue(prevState[key], value)) changedOther = true;
            writeParam(next, key, value, def);
          }
          if ('page' in d && !('page' in patch) && changedOther && !opts.keepPage) {
            writeParam(next, 'page', d.page, d.page);
          }
          return next;
        },
        { replace: !opts.push }
      );
    },
    [setSearchParams]
  );

  setState.reset = () => {
    const d = defaultsRef.current;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        Object.keys(d).forEach((k) => next.delete(k));
        return next;
      },
      { replace: true }
    );
  };

  return [state, setState];
}

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : [];
    const bb = Array.isArray(b) ? b : [];
    return aa.length === bb.length && aa.every((v, i) => String(v) === String(bb[i]));
  }
  return a === b;
}

export function parseParam(params, key, def) {
  if (Array.isArray(def)) {
    if (!params.has(key)) return def;
    return params.getAll(key).filter((v) => v !== '');
  }
  const raw = params.get(key);
  if (raw === null) return def;
  if (typeof def === 'number') {
    const n = Number(raw);
    return raw === '' || Number.isNaN(n) ? def : n;
  }
  if (typeof def === 'boolean') {
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return def;
  }
  return raw;
}

export function writeParam(params, key, value, def) {
  params.delete(key);
  if (def !== undefined && sameValue(value, def)) return;
  if (Array.isArray(value)) {
    const vals = value.filter((v) => v !== '' && v !== null && v !== undefined);
    if (vals.length === 0) {
      if (Array.isArray(def) && def.length > 0) params.append(key, '');
      return;
    }
    vals.forEach((v) => params.append(key, String(v)));
    return;
  }
  if (value === null || value === undefined || value === '') {
    // empty string when the default is non-empty must survive -> write key=
    if (typeof def === 'string' && def !== '') params.set(key, '');
    return;
  }
  if (typeof value === 'boolean') {
    params.set(key, value ? '1' : '0');
    return;
  }
  params.set(key, String(value));
}

// Named export too, so both import styles work.
export { useUrlState };
