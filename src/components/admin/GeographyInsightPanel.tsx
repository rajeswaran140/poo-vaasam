'use client';

/**
 * Audience Geography panel for /admin/youtube.
 *
 * Pick a video → fetch its owner-scoped country breakdown from
 * /api/admin/youtube/geography → show a ranked bar list of countries with
 * flags, views, view-share, and average-view-%. The decoration/summary math
 * lives in the pure (unit-tested) lib/youtube-geography.
 */

import { videoKind } from '@/lib/youtube-dashboard';
import { useVideoAnalysis } from '@/components/admin/useVideoAnalysis';
import type { GeographyRow } from '@/lib/youtube-geography';

interface GeographyResult {
  success: boolean;
  videoId: string;
  days: number;
  hasData: boolean;
  rows: GeographyRow[];
  totalAttributedViews: number;
  totalWatchMinutes: number;
  countryCount: number;
  topCountry: GeographyRow | null;
}

const numberFmt = new Intl.NumberFormat('en-US');

export function GeographyInsightPanel({
  videos,
  ytaConfigured,
}: {
  videos: Array<{ id: string; title: string; durationSeconds: number }>;
  ytaConfigured: boolean;
}) {
  // Shared hook: adminFetch (Bearer), out-of-order guard, and clear-on-change.
  const { videoId, setVideoId, loading, error, result, analyze } = useVideoAnalysis<GeographyResult>(
    videos,
    (id) => `/api/admin/youtube/geography?${new URLSearchParams({ videoId: id }).toString()}`
  );

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="geography-heading" className="space-y-2">
        <h2 id="geography-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Audience geography
        </h2>
        <p className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Connect YouTube Analytics (OAuth) to see which countries a video&apos;s viewers come from.
        </p>
      </section>
    );
  }

  const maxViews = Math.max(1, ...(result?.rows ?? []).map((r) => r.views));

  return (
    <section aria-labelledby="geography-heading" className="space-y-3">
      <div>
        <h2 id="geography-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Audience geography
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Which countries a video&apos;s viewers come from (owner-scoped, last 90 days). Country
          totals cover the geo-attributed, finalized subset — so they sum to less than lifetime views.
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
          {loading ? 'Loading…' : 'Show countries'}
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
              No finalized country data yet — a new upload needs ~1–3 days, and very-low-view videos
              may stay below YouTube&apos;s geography reporting threshold.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  <strong className="text-gray-900 dark:text-gray-100">{result.countryCount}</strong>{' '}
                  {result.countryCount === 1 ? 'country' : 'countries'}
                </span>
                <span>
                  <strong className="text-gray-900 dark:text-gray-100">
                    {numberFmt.format(result.totalAttributedViews)}
                  </strong>{' '}
                  attributed views
                </span>
                {result.topCountry && (
                  <span>
                    Top:{' '}
                    <strong className="text-gray-900 dark:text-gray-100">
                      <span aria-hidden>{result.topCountry.flag}</span> {result.topCountry.countryName}
                    </strong>{' '}
                    ({Math.round(result.topCountry.sharePct)}%)
                  </span>
                )}
              </div>

              <ul className="space-y-2">
                {result.rows.map((r) => {
                  const pct = Math.round((r.views / maxViews) * 100);
                  return (
                    <li key={r.country} className="text-sm">
                      <div className="mb-1 flex items-baseline justify-between gap-3">
                        <span className="font-medium text-gray-800 dark:text-gray-200">
                          <span aria-hidden className="mr-1">
                            {r.flag}
                          </span>
                          <span>{r.countryName}</span>
                          <span className="ml-2 text-xs text-gray-400">{Math.round(r.sharePct)}%</span>
                        </span>
                        <span className="tabular-nums text-gray-600 dark:text-gray-400">
                          {numberFmt.format(r.views)} views · {Math.round(r.averageViewPercentage)}% avg
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
