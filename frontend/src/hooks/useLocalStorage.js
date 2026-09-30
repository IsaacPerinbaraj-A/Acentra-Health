import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useLocalStorage(key, initialValue) -> [value, setValue, remove]
 * JSON-serialised, every access wrapped in try/catch (private mode / blocked storage
 * just falls back to in-memory state). All hooks using the same key stay in sync,
 * in this tab and across tabs.
 */

const SYNC_EVENT = 'risklens:local-storage';

export function readLocalStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeLocalStorage(key, value) {
  try {
    if (value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { key, value } }));
  } catch {
    /* ignore */
  }
}

export default function useLocalStorage(key, initialValue) {
  const initialRef = useRef(initialValue);
  const [value, setValue] = useState(() =>
    readLocalStorage(key, typeof initialValue === 'function' ? initialValue() : initialValue)
  );
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const onSync = (e) => {
      if (e.detail?.key !== key) return;
      setValue(e.detail.value === undefined ? initialRef.current : e.detail.value);
    };
    const onStorage = (e) => {
      if (e.key !== key) return;
      setValue(readLocalStorage(key, initialRef.current));
    };
    window.addEventListener(SYNC_EVENT, onSync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync);
      window.removeEventListener('storage', onStorage);
    };
  }, [key]);

  const set = useCallback(
    (next) => {
      const resolved = typeof next === 'function' ? next(valueRef.current) : next;
      valueRef.current = resolved;
      setValue(resolved);
      writeLocalStorage(key, resolved);
    },
    [key]
  );

  const remove = useCallback(() => {
    valueRef.current = initialRef.current;
    setValue(initialRef.current);
    writeLocalStorage(key, undefined);
  }, [key]);

  return [value, set, remove];
}

// Named export too, so both import styles work.
export { useLocalStorage };
