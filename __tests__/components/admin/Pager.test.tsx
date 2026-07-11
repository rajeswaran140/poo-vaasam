/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { usePagination } from '@/components/admin/Pager';

const makeRows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe('usePagination', () => {
  it('returns a single page when data fits (control stays hidden)', () => {
    const { result } = renderHook(() => usePagination(makeRows(10), 25));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.pageRows).toHaveLength(10);
    expect(result.current.total).toBe(10);
  });

  it('splits large data into pages and slices the current page', () => {
    const { result } = renderHook(() => usePagination(makeRows(60), 25));
    expect(result.current.totalPages).toBe(3);
    expect(result.current.pageRows).toHaveLength(25);
    expect(result.current.pageRows[0]).toEqual({ id: 0 });

    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
    expect(result.current.pageRows).toHaveLength(10); // 60 - 2*25
    expect(result.current.pageRows[0]).toEqual({ id: 50 });
  });

  it('clamps an out-of-range page to the last available page', () => {
    const { result } = renderHook(() => usePagination(makeRows(30), 25));
    act(() => result.current.setPage(99));
    expect(result.current.page).toBe(1);
    expect(result.current.pageRows[0]).toEqual({ id: 25 });
  });
});
