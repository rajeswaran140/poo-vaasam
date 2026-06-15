/**
 * Pure, framework-free helpers for the /admin/youtube videos panel.
 *
 * The panel merges two YouTube data sources into one comprehensive per-video
 * row:
 *   - YouTube Data API (lifetime public counts: views/likes/comments/duration)
 *   - YouTube Analytics API (date-ranged owner metrics: real views, subs
 *     gained, watch time, average view duration → a retention proxy)
 *
 * This is purely a YouTube view — it does NOT cross-reference the site's audio
 * song catalogue. Everything here is a pure function so it can be exhaustively
 * unit-tested and reused on both the server (initial merge) and the client
 * (re-merge when the admin changes the date range, sorts, filters, paginates,
 * or exports CSV).
 */

import type { VideoStats } from '@/lib/youtube-api';
import type { VideoAnalyticsRow } from '@/lib/youtube-analytics';
import { SHORTS_MAX_DURATION_SECONDS } from '@/lib/youtube-shorts';

/** Short vs regular-video classification by duration (the same ≤180s rule the
 *  public /videos shelf uses). Unknown/zero duration defaults to 'video' so a
 *  long upload missing its duration is never mislabelled a Short. */
export type VideoKind = 'short' | 'video';
export function videoKind(durationSeconds: number): VideoKind {
  return durationSeconds > 0 && durationSeconds <= SHORTS_MAX_DURATION_SECONDS ? 'short' : 'video';
}

export interface VideoRow {
  id: string;
  title: string;
  publishedAt: string; // ISO 8601 ('' when unknown)
  // Public Data API (lifetime, date-independent)
  viewCount: number;
  likeCount: number;
  commentCount: number;
  durationSeconds: number;
  // Owner Analytics (date-ranged) — null when Analytics isn't configured or
  // the video has no rows in the selected window.
  realViews: number | null;
  subscribersGained: number | null;
  estimatedMinutesWatched: number | null;
  averageViewDuration: number | null; // seconds
  retentionPct: number | null; // averageViewDuration / durationSeconds * 100
}

export type SortKey =
  | 'publishedAt'
  | 'title'
  | 'viewCount'
  | 'realViews'
  | 'likeCount'
  | 'commentCount'
  | 'durationSeconds'
  | 'subscribersGained'
  | 'estimatedMinutesWatched'
  | 'averageViewDuration'
  | 'retentionPct';

export type SortDir = 'asc' | 'desc';

/**
 * Retention proxy: what fraction of the video the average viewer watched.
 * Returns null when it can't be computed (no analytics, or zero-length video).
 * Rounded to a whole percent; not clamped (a value >100 is a real signal that
 * viewers replayed and is worth surfacing).
 */
export function computeRetentionPct(
  averageViewDuration: number | null,
  durationSeconds: number
): number | null {
  if (averageViewDuration == null || !Number.isFinite(averageViewDuration)) return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return Math.round((averageViewDuration / durationSeconds) * 100);
}

/** Build the merged rows from the two upstream YouTube datasets. */
export function mergeVideoRows(videos: VideoStats[], analytics: VideoAnalyticsRow[]): VideoRow[] {
  const byId = new Map(analytics.map((a) => [a.videoId, a]));
  return videos.map((v) => {
    const a = byId.get(v.id) ?? null;
    const averageViewDuration = a ? a.averageViewDuration : null;
    return {
      id: v.id,
      title: v.title,
      publishedAt: v.publishedAt,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      durationSeconds: v.durationSeconds,
      realViews: a ? a.views : null,
      subscribersGained: a ? a.subscribersGained : null,
      estimatedMinutesWatched: a ? a.estimatedMinutesWatched : null,
      averageViewDuration,
      retentionPct: computeRetentionPct(averageViewDuration, v.durationSeconds),
    };
  });
}

/**
 * Overlay a fresh Analytics dataset onto existing rows (used client-side when
 * the date range changes — the Data API fields are date-independent so they
 * stay put; only the analytics-derived fields are recomputed). Videos absent
 * from the new dataset have their analytics fields reset to null.
 */
export function applyVideoAnalytics(rows: VideoRow[], analytics: VideoAnalyticsRow[]): VideoRow[] {
  const byId = new Map(analytics.map((a) => [a.videoId, a]));
  return rows.map((r) => {
    const a = byId.get(r.id) ?? null;
    const averageViewDuration = a ? a.averageViewDuration : null;
    return {
      ...r,
      realViews: a ? a.views : null,
      subscribersGained: a ? a.subscribersGained : null,
      estimatedMinutesWatched: a ? a.estimatedMinutesWatched : null,
      averageViewDuration,
      retentionPct: computeRetentionPct(averageViewDuration, r.durationSeconds),
    };
  });
}

/**
 * Sort rows by a column. Nulls always sort to the end regardless of direction
 * (an unknown value shouldn't outrank a real low one). Strings compare
 * locale-insensitively; publishedAt compares by timestamp.
 */
export function sortVideoRows(rows: VideoRow[], key: SortKey, dir: SortDir): VideoRow[] {
  const factor = dir === 'asc' ? 1 : -1;
  const value = (r: VideoRow): number | string | null => {
    if (key === 'publishedAt') return r.publishedAt ? Date.parse(r.publishedAt) : null;
    return r[key];
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    // nulls last (independent of direction)
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string' && typeof vb === 'string') {
      return va.localeCompare(vb) * factor;
    }
    return ((va as number) - (vb as number)) * factor;
  });
}

/** Filter by a free-text title query and/or Short/Video kind. */
export function filterVideoRows(
  rows: VideoRow[],
  opts: { query?: string; kind?: VideoKind | 'all' }
): VideoRow[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  const kind = opts.kind ?? 'all';
  if (!q && kind === 'all') return [...rows];
  return rows.filter((r) => {
    if (q && !r.title.toLowerCase().includes(q)) return false;
    if (kind !== 'all' && videoKind(r.durationSeconds) !== kind) return false;
    return true;
  });
}

/**
 * The retention benchmark = the best-retention REGULAR video (Shorts excluded).
 *
 * Shorts hold far more of their audience simply by being short, so letting one
 * win the benchmark slot makes every long-form song's hook look "weak" against
 * an unbeatable ~90%+ Short — and the hook / "first 15s is the lever" coaching
 * is a long-form concept anyway. Returns null when no regular video has measured
 * retention yet, in which case the caller falls back to absolute thresholds.
 */
export function pickRetentionBenchmark(rows: VideoRow[]): VideoRow | null {
  let best: VideoRow | null = null;
  for (const r of rows) {
    if (r.retentionPct == null) continue;
    if (videoKind(r.durationSeconds) !== 'video') continue;
    if (!best || r.retentionPct > (best.retentionPct ?? 0)) best = r;
  }
  return best;
}

export interface Page<T> {
  items: T[];
  page: number; // 1-based, clamped to [1, totalPages]
  totalPages: number;
  total: number;
  pageSize: number;
}

/** Slice items into a 1-based page; clamps out-of-range pages. */
export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (clamped - 1) * size;
  return { items: items.slice(start, start + size), page: clamped, totalPages, total, pageSize: size };
}

const CSV_COLUMNS: Array<{ header: string; get: (r: VideoRow) => string | number | null }> = [
  { header: 'Title', get: (r) => r.title },
  { header: 'Type', get: (r) => (videoKind(r.durationSeconds) === 'short' ? 'Short' : 'Video') },
  { header: 'Published', get: (r) => (r.publishedAt ? r.publishedAt.slice(0, 10) : '') },
  { header: 'Views (public)', get: (r) => r.viewCount },
  { header: 'Real views', get: (r) => r.realViews },
  { header: 'Likes', get: (r) => r.likeCount },
  { header: 'Comments', get: (r) => r.commentCount },
  { header: 'Duration (s)', get: (r) => r.durationSeconds },
  { header: 'Subs gained', get: (r) => r.subscribersGained },
  { header: 'Watch time (min)', get: (r) => (r.estimatedMinutesWatched == null ? null : Math.round(r.estimatedMinutesWatched)) },
  { header: 'Avg view (s)', get: (r) => (r.averageViewDuration == null ? null : Math.round(r.averageViewDuration)) },
  { header: 'Retention %', get: (r) => r.retentionPct },
  { header: 'Video ID', get: (r) => r.id },
];

/** Escape one CSV field per RFC 4180 (quote when it contains , " or newline). */
function csvField(value: string | number | null): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize rows to CSV (header + one line per row). */
export function videoRowsToCsv(rows: VideoRow[]): string {
  const header = CSV_COLUMNS.map((c) => csvField(c.header)).join(',');
  const lines = rows.map((r) => CSV_COLUMNS.map((c) => csvField(c.get(r))).join(','));
  return [header, ...lines].join('\n');
}
