import { useEffect, useRef, useState, useCallback } from 'react';

/** useDebounce(value, delay = 300) -> value that updates `delay` ms after the last change. */
export default function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * useDebouncedCallback(fn, delay = 300) -> debounced function (latest fn always used).
 * The returned function has .cancel() and .flush().
 */
export function useDebouncedCallback(fn, delay = 300) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef(null);
  const lastArgs = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const debounced = useCallback(
    (...args) => {
      lastArgs.current = args;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        fnRef.current(...args);
      }, delay);
    },
    [delay]
  );
  debounced.cancel = () => {
    clearTimeout(timer.current);
    timer.current = null;
  };
  debounced.flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      fnRef.current(...(lastArgs.current || []));
    }
  };
  return debounced;
}

// Named export too, so both import styles work.
export { useDebounce };
