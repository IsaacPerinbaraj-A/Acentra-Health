import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * ThemeProvider: follows the OS by default; toggleTheme() switches and remembers the
 * choice in localStorage ("risklens.theme"). Sets data-theme on <html> synchronously
 * (before re-render) so CSS-variable readers such as useChartTheme() see new values.
 *
 * useTheme() -> { theme: 'light'|'dark', toggleTheme(), setTheme(theme|null), isDark, followsSystem }
 * setTheme(null) forgets the stored choice and follows the OS again.
 */

const STORAGE_KEY = 'risklens.theme';

const ThemeContext = createContext({
  theme: 'light',
  isDark: false,
  followsSystem: true,
  toggleTheme: () => {},
  setTheme: () => {},
});

function readStored() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function writeStored(value) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, value);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: theme still works for this session */
  }
}

function systemTheme() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (root.getAttribute('data-theme') !== theme) root.setAttribute('data-theme', theme);
}

export function ThemeProvider({ children }) {
  const [stored, setStored] = useState(readStored);
  const [system, setSystem] = useState(systemTheme);
  const theme = stored || system;

  // keep <html data-theme> in sync (first render + any change)
  applyTheme(theme);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => {
      const next = e.matches ? 'dark' : 'light';
      if (!readStored()) applyTheme(next);
      setSystem(next);
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  const setTheme = useCallback((next) => {
    const value = next === 'light' || next === 'dark' ? next : null;
    writeStored(value);
    applyTheme(value || systemTheme());
    setStored(value);
  }, []);

  const toggleTheme = useCallback(() => {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    setTheme(current === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  const value = useMemo(
    () => ({ theme, isDark: theme === 'dark', followsSystem: !stored, toggleTheme, setTheme }),
    [theme, stored, toggleTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export default ThemeContext;
