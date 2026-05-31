'use client';

/**
 * Admin theme provider — light / dark, user-chosen, persisted to localStorage.
 *
 * The admin layout wraps its root <div> with this provider; the provider
 * mounts the `dark` class on that wrapper when the saved preference (or
 * system preference, on first visit) is dark. Tailwind's `darkMode: 'class'`
 * strategy picks it up via the nearest ancestor, so `dark:` variants on
 * admin pages flip in/out without affecting the public site.
 *
 * SSR caveat: the initial render is whatever the server picked (light), so
 * there can be a one-frame flash when localStorage says "dark" — acceptable
 * for an admin-only UI. The inline init script in (admin)/layout.tsx
 * mitigates it by setting the class before paint.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type AdminTheme = 'light' | 'dark';

const STORAGE_KEY = 'tamilagaval:admin-theme';

interface ThemeContextValue {
  theme: AdminTheme;
  setTheme: (t: AdminTheme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useAdminTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useAdminTheme must be used inside <ThemeProvider>');
  return ctx;
}

function readInitialTheme(): AdminTheme {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* ignore (private mode, etc.) */ }
  // First visit — honour system preference.
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface Props {
  children: ReactNode;
  /** Optional class added to the wrapper alongside `dark`/`light`. */
  className?: string;
}

export function ThemeProvider({ children, className }: Props) {
  const [theme, setThemeState] = useState<AdminTheme>('light');

  // Hydrate from storage on mount (avoids a hydration mismatch — we render
  // 'light' on the server, then immediately swap to whatever the user has).
  useEffect(() => {
    setThemeState(readInitialTheme());
  }, []);

  const setTheme = useCallback((t: AdminTheme) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: AdminTheme = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggle }),
    [theme, setTheme, toggle]
  );

  return (
    <ThemeContext.Provider value={value}>
      <div className={`${theme === 'dark' ? 'dark' : ''} ${className ?? ''}`}>{children}</div>
    </ThemeContext.Provider>
  );
}
