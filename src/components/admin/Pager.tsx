'use client';

/**
 * usePagination — client-side pagination for admin tables. Returns the current
 * page's rows plus page state; the (tiny) prev/next control is rendered inline
 * by each panel and only shown once data exceeds one page ("once the data grows
 * large enough"). Keeping this a hook (not a component with a function prop)
 * sidesteps the client-entry serializable-props rule.
 */

import { useEffect, useState } from 'react';

export interface Pagination<T> {
  page: number;
  setPage: (n: number) => void;
  totalPages: number;
  pageRows: T[];
  pageSize: number;
  total: number;
}

/**
 * @param resetKey change this to jump back to page 1 — pass whatever defines
 * the current result SET (filters, search text). Clamping alone is not enough:
 * with 247 rows, searching from page 7 leaves you on the LAST page of the new
 * matches, which reads as "my search found nothing near the top". Optional, so
 * existing callers keep their behaviour exactly.
 */
export function usePagination<T>(rows: T[], pageSize = 25, resetKey?: unknown): Pagination<T> {
  const [page, setPage] = useState(0);
  // The dependency array already gates this: it fires on mount (a no-op, page
  // is 0) and thereafter only when the key actually changes. An earlier version
  // also tracked the previous key in a ref and compared it — mutation testing
  // showed neither the ref nor an `undefined` guard could change any outcome,
  // so both were removed rather than left as untestable code.
  useEffect(() => {
    setPage(0);
  }, [resetKey]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const clamped = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(clamped * pageSize, clamped * pageSize + pageSize);
  return { page: clamped, setPage, totalPages, pageRows, pageSize, total: rows.length };
}

/** Shared button class for the inline prev/next control. */
export const PAGER_BTN =
  'rounded-md border border-gray-300 dark:border-gray-700 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40';
