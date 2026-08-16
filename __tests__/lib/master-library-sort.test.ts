/** @jest-environment node */
/**
 * Library search + sort.
 *
 * These run over ONE LOADED PAGE, not the whole library, which is the subtlety
 * worth guarding: the rows arrive newest-first from a paginated index, so any
 * ordering here is local. The tests pin the behaviours that would otherwise
 * quietly mislead — unmeasured masters sinking rather than reading as silence,
 * and a stable order when values tie.
 */

import { filterMasters, sortMasters, LIBRARY_SORTS, type LibrarySort } from '@/lib/master-library';

type Row = { id: string; title: string | null; savedAt: string | null; measuredLufs?: number | null };

const rows: Row[] = [
  { id: 'a', title: 'பூபாளம் பாடும் நேரம்', savedAt: '2026-08-16T01:00:00Z', measuredLufs: -14.1 },
  { id: 'b', title: 'Rain came down this evening', savedAt: '2026-08-14T15:00:00Z', measuredLufs: -9.4 },
  { id: 'c', title: 'மரங்கொத்திப் பறவை போல்', savedAt: '2026-08-13T16:00:00Z', measuredLufs: -18.2 },
  { id: 'd', title: 'untitled take', savedAt: '2026-08-10T09:00:00Z', measuredLufs: null },
];

describe('filterMasters', () => {
  it('returns everything for an empty query', () => {
    expect(filterMasters(rows, '')).toHaveLength(4);
    expect(filterMasters(rows, '   ')).toHaveLength(4);
  });

  it('matches Tamil titles', () => {
    expect(filterMasters(rows, 'பூபாளம்').map((r) => r.id)).toEqual(['a']);
  });

  it('matches English case-insensitively, on a substring', () => {
    expect(filterMasters(rows, 'RAIN').map((r) => r.id)).toEqual(['b']);
    expect(filterMasters(rows, 'evening').map((r) => r.id)).toEqual(['b']);
  });

  it('survives a null title rather than throwing', () => {
    expect(filterMasters([{ title: null }], 'x')).toEqual([]);
  });

  it('does not mutate the input', () => {
    const copy = [...rows];
    filterMasters(rows, 'rain');
    expect(rows).toEqual(copy);
  });
});

describe('sortMasters', () => {
  it('defaults to newest first', () => {
    expect(sortMasters(rows, 'newest').map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reverses for oldest', () => {
    expect(sortMasters(rows, 'oldest').map((r) => r.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  /**
   * Sorted with `localeCompare(..., 'ta')`. Under Tamil collation the Tamil
   * titles come FIRST and Latin ones after — the opposite of the ASCII
   * assumption. Asserted against localeCompare itself rather than a guessed
   * order, so the test states the rule instead of a snapshot of it.
   */
  it('sorts by title using Tamil collation', () => {
    const sorted = sortMasters(rows, 'title').map((r) => r.title ?? '');
    expect(sorted).toEqual([...sorted].sort((a, b) => a.localeCompare(b, 'ta')));
    expect(sorted).toHaveLength(4);
    // Latin lands last under this collation.
    expect(sorted.at(-1)).toBe('untitled take');
  });

  it('orders loudest and quietest by measured LUFS', () => {
    expect(sortMasters(rows, 'loudest').slice(0, 2).map((r) => r.id)).toEqual(['b', 'a']);
    expect(sortMasters(rows, 'quietest').slice(0, 2).map((r) => r.id)).toEqual(['c', 'a']);
  });

  /**
   * ⚠️ A master with no measurement is UNKNOWN, not silent. `?? 0` would place
   * it as the loudest possible value (0 LUFS is deafening), so an unmeasured
   * row would head the "loudest" list and look like a clipping problem.
   */
  it('sinks unmeasured masters in BOTH loudness directions', () => {
    expect(sortMasters(rows, 'loudest').at(-1)!.id).toBe('d');
    expect(sortMasters(rows, 'quietest').at(-1)!.id).toBe('d');
  });

  it('falls back to date when two rows are equally unmeasured', () => {
    const two: Row[] = [
      { id: 'old', title: 'x', savedAt: '2026-01-01T00:00:00Z', measuredLufs: null },
      { id: 'new', title: 'y', savedAt: '2026-06-01T00:00:00Z', measuredLufs: null },
    ];
    expect(sortMasters(two, 'loudest').map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('does not mutate the input', () => {
    const copy = [...rows];
    sortMasters(rows, 'loudest');
    expect(rows).toEqual(copy);
  });

  it('handles every advertised sort without throwing', () => {
    for (const { id } of LIBRARY_SORTS) {
      expect(sortMasters(rows, id as LibrarySort)).toHaveLength(4);
    }
  });

  it('survives an empty page', () => {
    expect(sortMasters([], 'loudest')).toEqual([]);
  });
});
