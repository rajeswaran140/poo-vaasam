/** @jest-environment jsdom */
/**
 * usePagination — the shared admin-table pager.
 *
 * The behaviour worth pinning is what happens when the RESULT SET changes
 * underneath the current page. With the lexicon at 247 words that stopped
 * being hypothetical: searching from page 5 must land on the first page of
 * matches, not the last.
 */
import { renderHook, act } from '@testing-library/react';
import { usePagination } from '@/components/admin/Pager';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('usePagination', () => {
  it('slices the current page and reports the totals', () => {
    const { result } = renderHook(() => usePagination(rows(247), 50));
    expect(result.current.totalPages).toBe(5);
    expect(result.current.total).toBe(247);
    expect(result.current.pageRows).toHaveLength(50);
    expect(result.current.pageRows[0]).toBe(0);
    act(() => result.current.setPage(4));
    // 247 = 4 full pages of 50 + a final page of 47.
    expect(result.current.pageRows).toHaveLength(47);
    expect(result.current.pageRows[0]).toBe(200);
    expect(result.current.pageRows.at(-1)).toBe(246);
  });

  it('CLAMPS when the list shrinks under the current page', () => {
    // Archive/delete on the last page must not leave an empty table.
    const { result, rerender } = renderHook(({ r }) => usePagination(r, 50), {
      initialProps: { r: rows(247) },
    });
    act(() => result.current.setPage(4));
    rerender({ r: rows(60) });
    expect(result.current.page).toBe(1);
    expect(result.current.pageRows).toHaveLength(10);
  });

  it('RESETS to page 1 when the resetKey changes — not merely clamps', () => {
    const { result, rerender } = renderHook(({ r, k }) => usePagination(r, 50, k), {
      initialProps: { r: rows(247), k: 'all' },
    });
    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);
    // A search that still yields 5 pages: clamping alone would leave page 5.
    rerender({ r: rows(247), k: 'q=நில' });
    expect(result.current.page).toBe(0);
    expect(result.current.pageRows[0]).toBe(0);
  });

  it('lets you page NORMALLY once a filter is active', () => {
    // The nastiest failure mode: if prevKey is never updated after a reset,
    // every later render still looks like "the key changed" and snaps back to
    // page 1 — so with a search active you can never leave the first page.
    const { result, rerender } = renderHook(({ r, k }) => usePagination(r, 50, k), {
      initialProps: { r: rows(247), k: 'all' },
    });
    rerender({ r: rows(247), k: 'q=நில' });
    expect(result.current.page).toBe(0);
    act(() => result.current.setPage(2));
    rerender({ r: rows(247), k: 'q=நில' });
    expect(result.current.page).toBe(2);
    expect(result.current.pageRows[0]).toBe(100);
  });

  it('does not reset on an unrelated re-render with the same key', () => {
    const { result, rerender } = renderHook(({ r, k }) => usePagination(r, 50, k), {
      initialProps: { r: rows(247), k: 'all' },
    });
    act(() => result.current.setPage(3));
    rerender({ r: rows(247), k: 'all' });
    expect(result.current.page).toBe(3);
  });

  it('omitting resetKey preserves the old behaviour for existing callers', () => {
    const { result, rerender } = renderHook(({ r }) => usePagination(r, 25), {
      initialProps: { r: rows(100) },
    });
    act(() => result.current.setPage(3));
    rerender({ r: rows(100) });
    expect(result.current.page).toBe(3);
  });

  it('handles an empty list without a negative page', () => {
    const { result } = renderHook(() => usePagination([], 50));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.page).toBe(0);
    expect(result.current.pageRows).toEqual([]);
  });
});
