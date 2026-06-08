'use client';

/** Live character counter that mirrors the server limit (warns before a 400). */
import { counterState } from '@/lib/content/authoring';

export function CharCount({ value, max }: { value: string; max: number }) {
  const len = (value ?? '').length;
  const state = counterState(len, max);
  const color =
    state === 'over'
      ? 'text-red-600 dark:text-red-400 font-semibold'
      : state === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-gray-400 dark:text-gray-500';
  return (
    <span className={`text-xs tabular-nums ${color}`} aria-live="polite">
      {len}/{max}
    </span>
  );
}
