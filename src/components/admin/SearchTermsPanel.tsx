'use client';

/**
 * Search Discovery panel for /admin/youtube.
 *
 * Pick a video → fetch the REAL YouTube-search queries that brought it viewers
 * from /api/admin/youtube/search-terms → show a ranked bar list of terms with
 * views + watch-minutes.
 *
 * This is VIEWER TRUTH from the Analytics API — the terms people actually typed
 * to reach the video — NOT the unpersonalized public `search.list` ordering
 * (which can show a video as absent while the personalized app ranks it #1). So
 * an empty result here does NOT mean "not ranking"; it means search hasn't yet
 * *driven measurable views* (a new upload needs days to accumulate). Observed
 * rank positions live in the separate manual observation log, not here.
 */

import { videoKind } from '@/lib/youtube-dashboard';
import { useVideoAnalysis } from '@/components/admin/useVideoAnalysis';

interface SearchTermsResult {
  success: boolean;
  videoId: string | null;
  days: number;
  hasData: boolean;
  totalSearchViews: number;
  terms: Array<{ term: string; views: number; estimatedMinutesWatched: number }>;
}

const numberFmt = new Intl.NumberFormat('en-US');

export function SearchTermsPanel({
  videos,
  ytaConfigured,
}: {
  videos: Array<{ id: string; title: string; durationSeconds: number }>;
  ytaConfigured: boolean;
}) {
  const { videoId, setVideoId, loading, error, result, analyze } = useVideoAnalysis<SearchTermsResult>(
    videos,
    (id) => `/api/admin/youtube/search-terms?${new URLSearchParams({ videoId: id }).toString()}`
  );

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="search-terms-heading" className="space-y-2">
        <h2 id="search-terms-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Search discovery
        </h2>
        <p className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Connect YouTube Analytics (OAuth) to see the search queries that bring a video its viewers.
        </p>
      </section>
    );
  }

  const maxViews = Math.max(1, ...(result?.terms ?? []).map((t) => t.views));

  return (
    <section aria-labelledby="search-terms-heading" className="space-y-3">
      <div>
        <h2 id="search-terms-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Search discovery
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          The real queries viewers typed in YouTube search to reach a video (owner-scoped, last 90
          days). This is viewer truth — not a search-rank guess; an empty list means search hasn&apos;t
          yet driven measurable views, not that the video isn&apos;t ranking.
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
          {loading ? 'Loading…' : 'Show search terms'}
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
              No search-driven views yet. YouTube search takes a few days to accumulate for a new
              upload, and low-search videos stay below YouTube&apos;s reporting threshold — your
              personalized app rank can be #1 while this is still empty.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  <strong className="text-gray-900 dark:text-gray-100">{result.terms.length}</strong>{' '}
                  {result.terms.length === 1 ? 'search term' : 'search terms'}
                </span>
                <span>
                  <strong className="text-gray-900 dark:text-gray-100">
                    {numberFmt.format(result.totalSearchViews)}
                  </strong>{' '}
                  search-driven views
                </span>
              </div>

              <ul className="space-y-2">
                {result.terms.map((t) => {
                  const pct = Math.round((t.views / maxViews) * 100);
                  return (
                    <li key={t.term} className="text-sm">
                      <div className="mb-1 flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate font-medium text-gray-800 dark:text-gray-200">
                          {t.term}
                        </span>
                        <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-400">
                          {numberFmt.format(t.views)} views · {numberFmt.format(t.estimatedMinutesWatched)} min
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
