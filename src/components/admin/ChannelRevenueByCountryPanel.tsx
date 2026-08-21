'use client';

/**
 * Channel-wide revenue-by-country panel for /admin/analytics.
 *
 * Fetches GET /api/admin/youtube/channel-revenue-by-country and shows what each
 * market pays the WHOLE channel over the window, next to how much of the
 * audience it represents. Complements the per-video RevenueGeographyPanel
 * (which lives inside PerSongDeepDive) — that answers "which songs reach the
 * high-value audience"; this one answers "which markets pay this channel".
 *
 * All the math is in the pure (unit-tested) lib/youtube-revenue-geography;
 * this file only formats it — mirrors the visual vocabulary of
 * RevenueGeographyPanel so the two feel like one family.
 */

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { RevenueGeoRow } from '@/lib/youtube-revenue-geography';

interface ChannelRevenueGeoResult {
  success: boolean;
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
}

const usd = (n: number) => `$${n.toFixed(2)}`;
/** Sub-cent RPMs are common in tier-3 markets, so RPM gets three decimals. */
const rpmFmt = (n: number) => `$${n.toFixed(3)}`;

export function ChannelRevenueByCountryPanel({ days }: { days: number }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChannelRevenueGeoResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminFetch(`/api/admin/youtube/channel-revenue-by-country?days=${days}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: ChannelRevenueGeoResult) => {
        if (!cancelled) setResult(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <section aria-labelledby="channel-revenue-country-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="channel-revenue-country-heading"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          Revenue by country · channel · {days}d
        </h2>
        {result && result.hasData && (
          <p className="text-sm tabular-nums text-gray-600 dark:text-gray-400">
            {usd(result.totalRevenue)} total · {result.countryCount} markets · channel RPM{' '}
            {rpmFmt(result.rpm)}
          </p>
        )}
      </div>

      {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </p>
      )}

      {!loading && !error && result && !result.hasData && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400">
          No monetized activity in this window.
        </p>
      )}

      {!loading && !error && result && result.hasData && (
        <>
          {result.rpmBasis === 'country-attributed' && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
              The channel&apos;s undimensioned totals couldn&apos;t be fetched, so channel RPM and
              the ad rate are computed from the country rows — which under-count views and
              therefore <strong>overstate both</strong>. Treat as an upper bound.
            </p>
          )}

          {!result.servingAds && (
            <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200">
              No ad impressions recorded in the window — any revenue shown is the YouTube
              Premium share.
            </p>
          )}

          <div className="text-xs text-gray-500 dark:text-gray-400">
            {Math.round(result.monetizedPlaybackRate * 100)}% of views carried an ad
          </div>

          <ul className="space-y-2">
            {result.rows.map((r) => {
              // Guard against a top row of $0 collapsing every bar to 0 width.
              const maxRevenue = Math.max(
                0.0001,
                result.rows[0]?.estimatedRevenue ?? 0
              );
              const pct = Math.round((r.estimatedRevenue / maxRevenue) * 100);
              return (
                <li key={r.country} className="text-sm">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      <span aria-hidden className="mr-1">
                        {r.flag}
                      </span>
                      <span>{r.countryName}</span>
                      {r.valueIndex !== null && r.valueIndex >= 1.5 && (
                        <span
                          className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                          title="Revenue share ÷ view share — the market pays more than its share of the audience"
                        >
                          {r.valueIndex.toFixed(2)}× value
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums text-gray-600 dark:text-gray-400">
                      {usd(r.estimatedRevenue)} · {Math.round(r.revenueSharePct)}% of revenue ·{' '}
                      {Math.round(r.viewSharePct)}% of views ·{' '}
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
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Small markets can show revenue with no attributed views (they fall under
            YouTube&apos;s geo threshold) — their revenue counts toward the total but their
            RPM reads &ldquo;—&rdquo;.
          </p>
        </>
      )}
    </section>
  );
}
