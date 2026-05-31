'use client';

/**
 * Sun/Moon button that flips between light and dark admin themes. Reads from
 * the ThemeProvider context, persists via localStorage. Keyboard-accessible
 * (it's a real <button> with a descriptive aria-label).
 */

import { Sun, Moon } from 'lucide-react';
import { useAdminTheme } from '@/components/admin/ThemeProvider';

export function ThemeToggle() {
  const { theme, toggle } = useAdminTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
