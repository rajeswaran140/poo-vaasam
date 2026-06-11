/** @jest-environment node */
import {
  computeRetentionPct,
  mergeVideoRows,
  applyVideoAnalytics,
  sortVideoRows,
  filterVideoRows,
  paginate,
  videoRowsToCsv,
  type VideoRow,
} from '@/lib/youtube-dashboard';
import type { VideoStats } from '@/lib/youtube-api';
import type { VideoAnalyticsRow } from '@/lib/youtube-analytics';

const vs = (over: Partial<VideoStats> & { id: string }): VideoStats => ({
  id: over.id,
  title: over.title ?? `Video ${over.id}`,
  publishedAt: over.publishedAt ?? '2026-06-01T00:00:00Z',
  thumbnail: '',
  viewCount: over.viewCount ?? 0,
  likeCount: over.likeCount ?? 0,
  commentCount: over.commentCount ?? 0,
  duration: over.duration ?? 'PT4M',
  durationSeconds: over.durationSeconds ?? 240,
});

const an = (over: Partial<VideoAnalyticsRow> & { videoId: string }): VideoAnalyticsRow => ({
  videoId: over.videoId,
  views: over.views ?? 0,
  estimatedMinutesWatched: over.estimatedMinutesWatched ?? 0,
  averageViewDuration: over.averageViewDuration ?? 0,
  subscribersGained: over.subscribersGained ?? 0,
});

const row = (over: Partial<VideoRow> & { id: string }): VideoRow => ({
  id: over.id,
  title: over.title ?? `Video ${over.id}`,
  publishedAt: over.publishedAt ?? '2026-06-01T00:00:00Z',
  viewCount: over.viewCount ?? 0,
  likeCount: over.likeCount ?? 0,
  commentCount: over.commentCount ?? 0,
  durationSeconds: over.durationSeconds ?? 240,
  realViews: over.realViews ?? null,
  subscribersGained: over.subscribersGained ?? null,
  estimatedMinutesWatched: over.estimatedMinutesWatched ?? null,
  averageViewDuration: over.averageViewDuration ?? null,
  retentionPct: over.retentionPct ?? null,
});

describe('computeRetentionPct', () => {
  it('computes a rounded percent of the video watched', () => {
    expect(computeRetentionPct(120, 240)).toBe(50);
    expect(computeRetentionPct(183, 339)).toBe(54);
  });
  it('returns null when not computable', () => {
    expect(computeRetentionPct(null, 240)).toBeNull();
    expect(computeRetentionPct(100, 0)).toBeNull();
    expect(computeRetentionPct(100, -5)).toBeNull();
  });
});

describe('mergeVideoRows', () => {
  it('merges analytics into Data-API rows and computes retention', () => {
    const rows = mergeVideoRows(
      [vs({ id: 'a', viewCount: 1000, durationSeconds: 240 }), vs({ id: 'b' })],
      [an({ videoId: 'a', views: 800, subscribersGained: 5, averageViewDuration: 120, estimatedMinutesWatched: 99 })]
    );
    const a = rows.find((r) => r.id === 'a')!;
    const b = rows.find((r) => r.id === 'b')!;
    expect(a.realViews).toBe(800);
    expect(a.subscribersGained).toBe(5);
    expect(a.retentionPct).toBe(50);
    // no analytics row for b -> analytics fields null
    expect(b.realViews).toBeNull();
    expect(b.retentionPct).toBeNull();
  });
});

describe('applyVideoAnalytics', () => {
  it('overlays new analytics, keeps Data-API fields, nulls missing videos', () => {
    const base = [
      row({ id: 'a', viewCount: 1000, durationSeconds: 200, realViews: 1, subscribersGained: 1 }),
      row({ id: 'b', viewCount: 5, realViews: 9 }),
    ];
    const next = applyVideoAnalytics(base, [an({ videoId: 'a', views: 50, averageViewDuration: 100, subscribersGained: 3 })]);
    const a = next.find((r) => r.id === 'a')!;
    const b = next.find((r) => r.id === 'b')!;
    expect(a.viewCount).toBe(1000); // data-api preserved
    expect(a.realViews).toBe(50); // analytics overlaid
    expect(a.subscribersGained).toBe(3);
    expect(a.retentionPct).toBe(50); // 100/200
    expect(b.realViews).toBeNull(); // absent from new dataset
  });
});

describe('sortVideoRows', () => {
  const rows = [
    row({ id: 'a', viewCount: 100, realViews: 5, title: 'Banana', publishedAt: '2026-06-03T00:00:00Z' }),
    row({ id: 'b', viewCount: 300, realViews: null, title: 'apple', publishedAt: '2026-06-01T00:00:00Z' }),
    row({ id: 'c', viewCount: 200, realViews: 50, title: 'Cherry', publishedAt: '2026-06-02T00:00:00Z' }),
  ];
  it('sorts numbers desc and asc', () => {
    expect(sortVideoRows(rows, 'viewCount', 'desc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(sortVideoRows(rows, 'viewCount', 'asc').map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });
  it('always sorts nulls last, regardless of direction', () => {
    expect(sortVideoRows(rows, 'realViews', 'desc').map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(sortVideoRows(rows, 'realViews', 'asc').map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });
  it('sorts by publishedAt timestamp and by title', () => {
    expect(sortVideoRows(rows, 'publishedAt', 'asc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(sortVideoRows(rows, 'title', 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c']); // case-insensitive
  });
  it('does not mutate the input', () => {
    const copy = [...rows];
    sortVideoRows(rows, 'viewCount', 'asc');
    expect(rows).toEqual(copy);
  });
});

describe('filterVideoRows', () => {
  const rows = [
    row({ id: 'a', title: 'அன்னை பாடல்' }),
    row({ id: 'b', title: 'Love Song' }),
    row({ id: 'c', title: 'love letter' }),
  ];
  it('filters by case-insensitive title substring', () => {
    expect(filterVideoRows(rows, { query: 'love' }).map((r) => r.id)).toEqual(['b', 'c']);
    expect(filterVideoRows(rows, { query: 'அன்னை' }).map((r) => r.id)).toEqual(['a']);
  });
  it('empty/whitespace query matches all', () => {
    expect(filterVideoRows(rows, { query: '   ' })).toHaveLength(3);
    expect(filterVideoRows(rows, {})).toHaveLength(3);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 23 }, (_, i) => i);
  it('returns the right slice and total pages', () => {
    const p = paginate(items, 1, 10);
    expect(p.items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p.totalPages).toBe(3);
    expect(p.total).toBe(23);
  });
  it('returns a partial last page', () => {
    expect(paginate(items, 3, 10).items).toEqual([20, 21, 22]);
  });
  it('clamps out-of-range pages', () => {
    expect(paginate(items, 99, 10).page).toBe(3);
    expect(paginate(items, 0, 10).page).toBe(1);
    expect(paginate(items, -5, 10).page).toBe(1);
  });
  it('handles empty input (1 page, no items)', () => {
    const p = paginate([], 1, 10);
    expect(p.items).toEqual([]);
    expect(p.totalPages).toBe(1);
    expect(p.total).toBe(0);
  });
});

describe('videoRowsToCsv', () => {
  it('emits a header and one line per row', () => {
    const csv = videoRowsToCsv([row({ id: 'a', title: 'Hello', viewCount: 10, realViews: 8 })]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Title');
    expect(lines[0]).toContain('Real views');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Hello');
    expect(lines[1]).toContain('8');
  });
  it('escapes commas, quotes and newlines; nulls become empty', () => {
    const csv = videoRowsToCsv([row({ id: 'x', title: 'a, "b"\nc', realViews: null })]);
    const dataLine = csv.split('\n').slice(1).join('\n');
    expect(dataLine).toContain('"a, ""b""\nc"');
    // real views null -> two consecutive commas somewhere (empty field)
    expect(dataLine).toContain(',,');
  });
});
