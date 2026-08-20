'use client';

/**
 * Revenue-by-country panel for /admin/youtube.
 *
 * Pick a video → fetch its owner-scoped revenue breakdown from
 * /api/admin/youtube/revenue-geography → show what each country actually PAID,
 * next to the share of the audience it represents.
 *
 * The panel exists because per-country VIEWS can't answer the question that
 * matters for programming: which songs reach the small, high-value slice of the
 * audience. All the math is in the pure (unit-tested) lib/youtube-revenue-geography;
 * this file only formats it.
 */

import { videoKind } from '@/lib/youtube-dashboard';
import { useVideoAnalysis } from '@/components/admin/useVideoAnalysis';
import type { RevenueGeoRow } from '@/lib/youtube-revenue-geography';

interface RevenueGeoResult {
  success: boolean;
  videoId: string;
  days: number;
  hasData: boolean;
  rows: RevenueGeoRow[];
  attributedViews: number;
  attributedRevenue: number;
  totalViews: number;
  totalRevenue: number;
  totalAdRevenue: number;
  totalPremiumRevenue: number;
  totalAdImpressions: number;
  totalMonetizedPlaybacks: number;
  rpm: number;
  rpmBasis: 'video-totals' | 'country-attributed';
  monetizedPlaybackRate: number;
  servingAds: boolean;
  countryCount: number;
  topRevenueCountry: RevenueGeoRow | null;
  rpmIndex: number | null;
  channelRpm: number | null;
}

const numberFmt = new Intl.NumberFormat('en-US');
const usd = (n: number) => `$${n.toFixed(2)}`;
/** Sub-cent RPMs are common here, so RPM gets three decimals, not two. */
const rpmFmt = (n: number) => `$${n.toFixed(3)}`;

export function RevenueGeographyPanel({
  videos,
  ytaConfigured,
}: {
  videos: Array<{ id: string; title: string; durationSeconds: number }>;
  ytaConfigured: boolean;
}) {
  const { videoId, setVideoId, loading, error, result, analyze } =
    useVideoAnalysis<RevenueGeoResult>(
      videos,
      (id) => `/api/admin/youtube/revenue-geography?${new URLSearchParams({ videoId: id }).toString()}`
    );

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="revenue-geo-heading" className="space-y-2">
        <h2 id="revenue-geo-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Revenue by country
        </h2>
        <p className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Connect YouTube Analytics (OAuth, with the monetary scope) to see what each country pays.
        </p>
      </section>
    );
  }

  const maxRevenue = Math.max(
    0.0001,
    ...(result?.rows ?? []).map((r) => r.estimatedRevenue)
  );

  return (
    <section aria-labelledby="revenue-geo-heading" className="space-y-3">
      <div>
        <h2 id="revenue-geo-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Revenue by country
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          What each country actually pays, against the share of the audience it represents
          (owner-scoped, last 28 days). Revenue lags 2–3 days. A country&apos;s value index above
          1.0 means it pays more than its share of the views — those are the songs worth
          programming into gateway playlists.
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
          {loading ? 'Loading…' : 'Show earnings'}
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
              No revenue rows yet — a new upload needs ~2–3 days, and a video below YouTube&apos;s
              reporting threshold stays blank.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm">
                <span className="text-gray-600 dark:text-gray-300">
                  <strong className="text-gray-900 dark:text-gray-100">{usd(result.totalRevenue)}</strong>{' '}
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    over {numberFmt.format(result.totalViews)} views
                  </span>
                </span>
                <span className="text-gray-600 dark:text-gray-300">
                  RPM <strong className="text-gray-900 dark:text-gray-100">{rpmFmt(result.rpm)}</strong>
                </span>
                {result.rpmIndex !== null ? (
                  <span
                    className={
                      result.rpmIndex >= 1
                        ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
                        : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    }
                  >
                    {result.rpmIndex.toFixed(2)}× channel average
                    {result.channelRpm !== null && (
                      <span className="ml-1 font-normal opacity-75">
                        (channel {rpmFmt(result.channelRpm)})
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    No channel baseline available
                  </span>
                )}
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {Math.round(result.monetizedPlaybackRate * 100)}% of views carried an ad
                </span>
              </div>

              {result.rpmBasis === 'country-attributed' && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                  The video&apos;s own totals couldn&apos;t be fetched, so RPM and the ad rate are
                  computed from the country rows — which under-count views and therefore
                  <strong> overstate both</strong>. Treat them as an upper bound, not a reading.
                </p>
              )}

              {!result.servingAds && (
                <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200">
                  No ad impressions recorded on this video in the window — consistent with
                  monetization being off. Any revenue shown is the YouTube Premium share.
                </p>
              )}

              <ul className="space-y-2">
                {result.rows.map((r) => {
                  const pct = Math.round((r.estimatedRevenue / maxRevenue) * 100);
                  return (
                    <li key={r.country} className="text-sm">
                      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="font-medium text-gray-800 dark:text-gray-200">
                          <span aria-hidden className="mr-1">
                            {r.flag}
                          </span>
                          <span>{r.countryName}</span>
                          {r.valueIndex !== null && (
                            <span
                              className={
                                r.valueIndex >= 1
                                  ? 'ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
                                  : 'ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                              }
                              title="Revenue share ÷ view share"
                            >
                              {r.valueIndex.toFixed(2)}× value
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums text-gray-600 dark:text-gray-400">
                          {usd(r.estimatedRevenue)} · {Math.round(r.revenueSharePct)}% of revenue
                          {' · '}
                          {Math.round(r.viewSharePct)}% of views
                          {' · '}
                          {r.rpm === null ? (
                            <span title="No attributed views in this market — per-view value is unknowable">
                              RPM —
                            </span>
                          ) : (
                            <>RPM {rpmFmt(r.rpm)}</>
                          )}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>

              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                Small markets can show revenue with no attributed views (they fall under
                YouTube&apos;s geo threshold) — their revenue counts toward the total but their RPM
                reads &ldquo;—&rdquo;.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
