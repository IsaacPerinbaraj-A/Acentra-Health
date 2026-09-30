import { useEffect, useRef } from 'react';

/**
 * usePolling(callback, intervalMs, { enabled = true, immediate = false, pauseWhenHidden = true })
 * Calls `callback` every `intervalMs` while enabled. Pauses while the tab is hidden and
 * fires once when it becomes visible again. Async callbacks never overlap.
 */
export default function usePolling(callback, intervalMs, options = {}) {
  const { enabled = true, immediate = false, pauseWhenHidden = true } = options;
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled || !intervalMs || intervalMs <= 0) return undefined;
    let timer = null;
    let running = false;
    let stopped = false;

    const tick = async () => {
      if (running || stopped) return;
      if (pauseWhenHidden && typeof document !== 'undefined' && document.hidden) return;
      running = true;
      try {
        await cbRef.current();
      } catch {
        /* callers handle their own errors */
      } finally {
        running = false;
      }
    };

    if (immediate) tick();
    timer = setInterval(tick, intervalMs);

    const onVisible = () => {
      if (!document.hidden) tick();
    };
    if (pauseWhenHidden) document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(timer);
      if (pauseWhenHidden) document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs, immediate, pauseWhenHidden]);
}

// Named export too, so both import styles work.
export { usePolling };
