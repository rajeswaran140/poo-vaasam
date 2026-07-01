'use client';

/**
 * Interactive videos analytics table for /admin/youtube.
 *
 * One comprehensive per-video view (public Data-API counts + owner Analytics
 * metrics + on-site flag) with client-side search, on-site filter, column
 * sorting, pagination, and CSV export — plus a date-range selector that
 * re-queries owner Analytics live via /api/admin/youtube/analytics.
 *
 * All list logic lives in pure, unit-tested helpers in lib/youtube-dashboard;
 * this component is the thin stateful shell around them.
 */

import { useMemo, useRef, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { formatDuration } from '@/lib/youtube-api';
import { adminFetch } from '@/lib/client-auth';
import type { VideoAnalyticsRow, Result } from '@/lib/youtube-analytics';
import {
  applyVideoAnalytics,
  filterVideoRows,
  paginate,
  sortVideoRows,
  videoKind,
  videoRowsToCsv,
  type SortDir,
  type SortKey,
  type VideoKind,
  type VideoRow,
} from '@/lib/youtube-dashboard';

const numberFmt = new Intl.NumberFormat('en-US');
const PAGE_SIZES = [10, 25, 50];
const DATE_RANGES = [7, 28, 90];

interface Column {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
  defaultDir: SortDir;
  /** owner-Analytics derived column — only meaningful when Analytics is on */
  analytics?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'title', label: 'Video', align: 'left', defaultDir: 'asc' },
  { key: 'publishedAt', label: 'Published', align: 'right', defaultDir: 'desc' },
  { key: 'viewCount', label: 'Views (public)', align: 'right', defaultDir: 'desc' },
  { key: 'realViews', label: 'Real views', align: 'right', defaultDir: 'desc', analytics: true },
  { key: 'subscribersGained', label: 'Subs +', align: 'right', defaultDir: 'desc', analytics: true },
  { key: 'retentionPct', label: 'Retention', align: 'right', defaultDir: 'desc', analytics: true },
  { key: 'averageViewDuration', label: 'Avg view', align: 'right', defaultDir: 'desc', analytics: true },
  { key: 'likeCount', label: 'Likes', align: 'right', defaultDir: 'desc' },
  { key: 'commentCount', label: 'Comments', align: 'right', defaultDir: 'desc' },
  { key: 'durationSeconds', label: 'Length', align: 'right', defaultDir: 'desc' },
];

export function YouTubeVideosPanel({
  initialRows,
  ytaConfigured,
  initialDays = 28,
}: {
  initialRows: VideoRow[];
  ytaConfigured: boolean;
  initialDays?: number;
}) {
  const [rows, setRows] = useState<VideoRow[]>(initialRows);
  const [days, setDays] = useState(initialDays);
  const [loading, setLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  // Monotonic token so a slow analytics response from an OLD range can't clobber
  // the result of a newer one (rapid date-range switches).
  const reqId = useRef(0);

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<VideoKind | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('publishedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const visibleColumns = useMemo(
    () => COLUMNS.filter((c) => ytaConfigured || !c.analytics),
    [ytaConfigured]
  );

  // filter -> sort -> paginate (all pure, all tested)
  const filtered = useMemo(() => filterVideoRows(rows, { query, kind }), [rows, query, kind]);
  // Counts for the Videos/Shorts toggle reflect the current text search but not
  // the kind filter itself, so each chip shows how many of each would match.
  const kindCounts = useMemo(() => {
    const byQuery = filterVideoRows(rows, { query });
    let short = 0;
    for (const r of byQuery) if (videoKind(r.durationSeconds) === 'short') short++;
    return { all: byQuery.length, short, video: byQuery.length - short };
  }, [rows, query]);
  const sorted = useMemo(() => sortVideoRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  const pageData = useMemo(() => paginate(sorted, page, pageSize), [sorted, page, pageSize]);

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(COLUMNS.find((c) => c.key === key)?.defaultDir ?? 'desc');
    }
    setPage(1);
  }

  async function changeDays(next: number) {
    const myReq = ++reqId.current;
    const prev = days;
    setDays(next);
    setRangeError(null);
    setLoading(true);
    try {
      // Bearer-authenticated (Amplify stores the token in browser storage, not a
      // reliable cookie) — a plain fetch 401s.
      const res = await adminFetch(`/api/admin/youtube/analytics?days=${next}&recs=0`);
      if (!res.ok) throw new Error(`Analytics request failed (${res.status})`);
      const json = (await res.json()) as { videos?: Result<VideoAnalyticsRow[]> };
      const v = json.videos;
      if (!v || !v.ok) throw new Error(v && !v.ok ? v.error : 'No analytics returned');
      if (myReq !== reqId.current) return; // superseded by a newer range selection
      setRows(applyVideoAnalytics(initialRows, v.data));
      setPage(1);
    } catch (err) {
      if (myReq === reqId.current) {
        // Revert the range label so the header + CSV filename keep matching the
        // data that's actually still loaded (the previous range).
        setDays(prev);
        setRangeError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (myReq === reqId.current) setLoading(false);
    }
  }

  function exportCsv() {
    const csv = videoRowsToCsv(sorted); // export the full filtered+sorted set, not just the page
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tamilagaval-youtube-${days}d.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const from = pageData.total === 0 ? 0 : (pageData.page - 1) * pageData.pageSize + 1;
  const to = Math.min(pageData.page * pageData.pageSize, pageData.total);

  return (
    <section aria-labelledby="videos-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="videos-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Videos
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <strong>Views</strong> = public counter (can lag).{' '}
            <strong>Real views</strong>/<strong>Retention</strong> = YouTube Analytics over the selected window.
            {!ytaConfigured && ' Connect YouTube Analytics to unlock the owner metrics + date range.'}
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={sorted.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          <Download className="h-4 w-4" aria-hidden /> Export CSV
        </button>
      </div>

      {/* Toolbar: search · on-site filter · date range */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative">
          <span className="sr-only">Search videos by title</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search title…"
            className="w-56 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 py-1.5 pl-8 pr-3 text-sm text-gray-900 dark:text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
        </label>

        {/* Short vs regular-video filter — the analytics mixed both with no way
            to tell them apart. */}
        <div role="group" aria-label="Filter by type" className="inline-flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-700 text-sm">
          {([['all', 'All'], ['video', 'Videos'], ['short', 'Shorts']] as const).map(([val, label], i) => (
            <button
              key={val}
              type="button"
              onClick={() => { setKind(val); setPage(1); }}
              aria-pressed={kind === val}
              className={`px-3 py-1.5 ${i > 0 ? 'border-l border-gray-300 dark:border-gray-700' : ''} ${
                kind === val
                  ? 'bg-orange-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              {label} <span className="tabular-nums opacity-70">({kindCounts[val]})</span>
            </button>
          ))}
        </div>

        {ytaConfigured && (
          <label className="ml-auto flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            Range
            <select
              value={days}
              onChange={(e) => changeDays(Number(e.target.value))}
              disabled={loading}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 disabled:opacity-50"
            >
              {DATE_RANGES.map((d) => (
                <option key={d} value={d}>Last {d} days</option>
              ))}
            </select>
            {loading && <span className="text-xs text-gray-400">updating…</span>}
          </label>
        )}
      </div>

      {rangeError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">
          Couldn&apos;t update the date range: {rangeError}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Per-video YouTube statistics — public and owner-analytics metrics, sortable and filterable.
          </caption>
          <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <tr>
              {visibleColumns.map((c) => {
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={`px-4 py-3 ${c.align === 'right' ? 'text-right' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      className={`inline-flex items-center gap-1 ${c.align === 'right' ? 'flex-row-reverse' : ''} hover:text-gray-800 dark:hover:text-gray-200 ${active ? 'text-gray-900 dark:text-gray-100' : ''}`}
                    >
                      {c.label}
                      <span aria-hidden className="text-[10px]">{active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {pageData.items.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                  No videos match the current filters.
                </td>
              </tr>
            ) : (
              pageData.items.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3 max-w-xs">
                    <a
                      href={`https://www.youtube.com/watch?v=${v.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate font-medium text-gray-900 dark:text-gray-100 hover:text-orange-600"
                      title={v.title}
                    >
                      {v.title}
                    </a>
                    <KindBadge kind={videoKind(v.durationSeconds)} />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500 dark:text-gray-400">
                    {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">{numberFmt.format(v.viewCount)}</td>
                  {ytaConfigured && (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">{fmtNum(v.realViews)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{v.subscribersGained == null ? dash() : (v.subscribersGained >= 0 ? `+${v.subscribersGained}` : v.subscribersGained)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{v.retentionPct == null ? dash() : `${v.retentionPct}%`}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{v.averageViewDuration == null ? dash() : `${Math.round(v.averageViewDuration)}s`}</td>
                    </>
                  )}
                  <td className="px-4 py-3 text-right tabular-nums">{numberFmt.format(v.likeCount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{numberFmt.format(v.commentCount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{formatDuration(v.durationSeconds)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <span>
            {from}–{to} of {numberFmt.format(pageData.total)}
          </span>
          <label className="flex items-center gap-1">
            <span className="sr-only">Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-1.5 py-1 text-xs text-gray-900 dark:text-gray-100"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>{s}/page</option>
              ))}
            </select>
          </label>
        </div>
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <PageButton label="First" onClick={() => setPage(1)} disabled={pageData.page <= 1}>«</PageButton>
          <PageButton label="Previous" onClick={() => setPage((p) => p - 1)} disabled={pageData.page <= 1}>‹</PageButton>
          <span className="px-2 tabular-nums">Page {pageData.page} / {pageData.totalPages}</span>
          <PageButton label="Next" onClick={() => setPage((p) => p + 1)} disabled={pageData.page >= pageData.totalPages}>›</PageButton>
          <PageButton label="Last" onClick={() => setPage(pageData.totalPages)} disabled={pageData.page >= pageData.totalPages}>»</PageButton>
        </nav>
      </div>
    </section>
  );
}

function KindBadge({ kind }: { kind: VideoKind }) {
  const isShort = kind === 'short';
  return (
    <span
      className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        isShort
          ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'
          : 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
      }`}
    >
      {isShort ? 'Short' : 'Video'}
    </span>
  );
}

function fmtNum(n: number | null) {
  return n == null ? dash() : numberFmt.format(n);
}
function dash() {
  return <span className="text-gray-400">—</span>;
}

function PageButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1 font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
