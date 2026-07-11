'use client';

/**
 * Song Trend panel for /admin/youtube — the per-song DAILY view.
 *
 * Pick a song → fetch its day-by-day views / subscribers / watch-time from
 * /api/admin/youtube/video-daily → an at-a-glance summary (totals, best day,
 * 7-vs-prior-7) plus a daily bar chart. This is the intersection the dashboard
 * was missing: one song's day-by-day curve (not just its aggregate).
 */

import { videoKind } from '@/lib/youtube-dashboard';
import type { VideoDailySummary } from '@/lib/youtube-dashboard';
import type { DailyAnalyticsRow } from '@/lib/youtube-analytics';
import { useVideoAnalysis } from '@/components/admin/useVideoAnalysis';

interface SongTrendResult {
  success: boolean;
  videoId: string;
  days: number;
  hasData: boolean;
  summary: VideoDailySummary;
  rows: DailyAnalyticsRow[];
}

const numberFmt = new Intl.NumberFormat('en-US');

function TrendBadge({ last7, prev7 }: { last7: number; prev7: number }) {
  if (prev7 === 0) return <span className="text-gray-400">—</span>;
  const pct = Math.round(((last7 - prev7) / prev7) * 100);
  const up = pct >= 0;
  return (
    <span className={up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  );
}

export function SongTrendPanel({
  videos,
  ytaConfigured,
}: {
  videos: Array<{ id: string; title: string; durationSeconds: number }>;
  ytaConfigured: boolean;
}) {
  const { videoId, setVideoId, loading, error, result, analyze } = useVideoAnalysis<SongTrendResult>(
    videos,
    (id) => `/api/admin/youtube/video-daily?${new URLSearchParams({ videoId: id }).toString()}`
  );

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="song-trend-heading" className="space-y-2">
        <h2 id="song-trend-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Song trend (daily)
        </h2>
        <p className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Connect YouTube Analytics (OAuth) to see a song&apos;s day-by-day views and subscribers.
        </p>
      </section>
    );
  }

  const maxViews = Math.max(1, ...(result?.rows ?? []).map((r) => r.views));

  return (
    <section aria-labelledby="song-trend-heading" className="space-y-3">
      <div>
        <h2 id="song-trend-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Song trend (daily)
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          One song&apos;s day-by-day views + subscribers (owner-scoped). Today is excluded (YouTube
          hasn&apos;t finalized it).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span className="sr-only">Choose a video</span>
          <select
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            className="max-w-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100"
          >
            {videos.map((vid) => (
              <option key={vid.id} value={vid.id}>
                {vid.title}
                {videoKind(vid.durationSeconds) === 'short' ? ' · Short' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={analyze}
          disabled={loading || !videoId}
          className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Show daily trend'}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">
          {error}
        </p>
      )}

      {result && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm space-y-4">
          {!result.hasData ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No finalized daily data yet — a new upload needs ~1–2 days before its day-by-day series
              appears.
            </p>
          ) : (
            <>
              {/* At-a-glance summary tiles */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Views</div>
                  <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {numberFmt.format(result.summary.totalViews)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Subscribers</div>
                  <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {result.summary.totalSubscribers >= 0 ? '+' : ''}
                    {numberFmt.format(result.summary.totalSubscribers)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Watch (min)</div>
                  <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {numberFmt.format(result.summary.totalWatchMinutes)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">7d vs prior</div>
                  <div className="text-lg font-semibold tabular-nums">
                    <TrendBadge last7={result.summary.last7Views} prev7={result.summary.prev7Views} />
                  </div>
                </div>
              </div>
              {result.summary.bestDay && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Best day:{' '}
                  <strong className="text-gray-900 dark:text-gray-100">{result.summary.bestDay.date}</strong> ·{' '}
                  {numberFmt.format(result.summary.bestDay.views)} views
                </p>
              )}

              {/* Daily bars — views per day, subs annotated */}
              <ul className="space-y-1.5">
                {result.rows.map((r) => {
                  const pct = Math.round((r.views / maxViews) * 100);
                  return (
                    <li key={r.date} className="text-xs">
                      <div className="mb-0.5 flex items-baseline justify-between gap-3">
                        <span className="tabular-nums text-gray-500 dark:text-gray-400">{r.date}</span>
                        <span className="tabular-nums text-gray-700 dark:text-gray-300">
                          {numberFmt.format(r.views)} views
                          {r.subscribersGained ? ` · ${r.subscribersGained > 0 ? '+' : ''}${r.subscribersGained} sub` : ''}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
