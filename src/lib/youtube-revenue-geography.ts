/**
 * Pure helpers for per-video REVENUE by country (YouTube Analytics `country`
 * dimension with the monetary metrics). The network fetch lives in
 * lib/youtube-analytics (fetchVideoRevenueGeography); everything here is pure
 * and unit-tested.
 *
 * WHY THIS EXISTS, separately from lib/youtube-geography: views tell you where
 * the audience is, and for this channel that answer is settled — ~83% India and
 * Sri Lanka. Revenue tells you which songs reach the ~5% of viewers who are
 * worth ~20x per view, and those are not the same songs. Programming a gateway
 * playlist toward the second group is the only lever that moves channel RPM;
 * growing volume at the current mix pushes it DOWN, because incremental
 * algorithm-fed views land where the audience already is.
 *
 * ⚠️ THREE RULES THIS MODULE ENCODES — do not "simplify" them away.
 *
 * 1. RPM IS Σrevenue / Σviews, NEVER AN AVERAGE OF PER-COUNTRY CPMs. YouTube
 *    hands back a playbackBasedCpm per country and averaging them treats a
 *    24-view market as equal to a 98,000-view one. Measured, that turns a real
 *    $0.43 into a fictional $32.
 * 2. THE DENOMINATOR IS VIEWS, NOT MONETIZED PLAYBACKS. That difference is the
 *    whole distinction between RPM and CPM: unmonetized playbacks are part of
 *    what a view is worth. Reporting revenue per monetized playback and calling
 *    it RPM flatters every number.
 * 3. A COUNTRY CAN EARN WITH ZERO ATTRIBUTED VIEWS. Observed 2026-08-19 for
 *    DK/NO/FI/BH/BE — small markets fall under YouTube's geo-attribution
 *    threshold while their ad impressions still bill. Their revenue belongs in
 *    the total; their per-view figures are UNKNOWABLE and surface as null, not
 *    as zero and not as Infinity.
 * 4. THE COUNTRY ROWS ARE A DISTRIBUTION, NOT A TOTAL. Rule 3 has a corollary
 *    that is easy to miss and silently wrong: because those markets report ad
 *    impressions and monetized playbacks WITHOUT views, summing the country
 *    column under-counts views while fully counting everything else. Measured
 *    on `lWt5kvapFKs`: country-attributed views 5,418 against 7,959 monetized
 *    playbacks — a "monetized rate" of 147%, and an RPM inflated by the same
 *    error. So any RATE must divide by the video's UNDIMENSIONED total views
 *    (`videoTotals`), never by the country sum. The country rows are only ever
 *    used for SHARES, which are internally consistent. When no `videoTotals` is
 *    supplied the summary says so via `rpmBasis`, rather than quietly serving
 *    the inflated figure.
 */

import { countryName, flagEmoji } from '@/lib/youtube-geography';

/** One raw row from the Analytics `country` report with monetary metrics. */
export interface RevenueGeoRawRow {
  country: string; // ISO 3166-1 alpha-2; YouTube uses "ZZ" for unknown
  views: number;
  estimatedRevenue: number; // net, USD
  estimatedAdRevenue: number; // Watch Page ads, USD
  estimatedRedPartnerRevenue: number; // YouTube Premium share, USD
  adImpressions: number;
  monetizedPlaybacks: number;
}

/** A raw row decorated with display fields and the derived value signals. */
export interface RevenueGeoRow extends RevenueGeoRawRow {
  countryName: string;
  flag: string;
  viewSharePct: number; // 0..100
  revenueSharePct: number; // 0..100
  /** Revenue per 1,000 views. `null` when the country has no attributed views. */
  rpm: number | null;
  /**
   * revenueShare ÷ viewShare. >1 = this country pays more than its share of the
   * audience; <1 = it pays less. `null` when the country has no attributed views.
   */
  valueIndex: number | null;
}

export interface RevenueGeoSummary {
  rows: RevenueGeoRow[]; // sorted by revenue desc — the money leads
  /** Views summed over the country rows — UNDER-COUNTS. Shares only (rule 4). */
  attributedViews: number;
  /** Revenue summed over the country rows. */
  attributedRevenue: number;
  /** The video's true views: undimensioned when available, else attributed. */
  totalViews: number;
  /** The video's true revenue: undimensioned when available, else attributed. */
  totalRevenue: number;
  totalAdRevenue: number;
  totalPremiumRevenue: number;
  totalAdImpressions: number;
  totalMonetizedPlaybacks: number;
  /** Revenue per 1,000 views for this video. Denominator per `rpmBasis`. */
  rpm: number;
  /**
   * Which denominator `rpm` and `monetizedPlaybackRate` were computed against.
   * `country-attributed` means no undimensioned totals were supplied, so both
   * rates are OVERSTATED — the UI must say so rather than present them plainly.
   */
  rpmBasis: 'video-totals' | 'country-attributed';
  /** Monetized playbacks ÷ views, 0..1. Low = ads are off or largely unserved. */
  monetizedPlaybackRate: number;
  /** False when not one country recorded an ad impression — i.e. ads are off. */
  servingAds: boolean;
  countryCount: number;
  topRevenueCountry: RevenueGeoRow | null;
  /**
   * This video's RPM ÷ the channel's RPM over the same window. >1 = it reaches a
   * higher-value audience than the channel average. `null` when no baseline was
   * supplied — a missing baseline must read as missing, because 1.0 would assert
   * "exactly average", which we have not measured.
   */
  rpmIndex: number | null;
}

export interface RevenueGeoContext {
  /** Channel-wide revenue per 1,000 views over the same window. */
  channelRpm?: number;
  /**
   * The video's UNDIMENSIONED totals over the same window. Required for a
   * correct RPM — see rule 4. Without it the rates fall back to the
   * country-attributed sums and are flagged as such.
   */
  videoTotals?: { views: number; estimatedRevenue: number; monetizedPlaybacks: number };
}

/** Parse raw rows: [country, views, revenue, adRev, premiumRev, adImpr, monetizedPlaybacks]. */
export function parseRevenueGeoRows(
  rows: Array<Array<string | number>> | undefined | null
): RevenueGeoRawRow[] {
  return (rows ?? []).map((r) => ({
    country: String(r[0] ?? ''),
    views: Number(r[1] ?? 0),
    estimatedRevenue: Number(r[2] ?? 0),
    estimatedAdRevenue: Number(r[3] ?? 0),
    estimatedRedPartnerRevenue: Number(r[4] ?? 0),
    adImpressions: Number(r[5] ?? 0),
    monetizedPlaybacks: Number(r[6] ?? 0),
  }));
}

/** Decorate, sort by revenue, and derive the value signals. */
export function summarizeRevenueGeography(
  raw: RevenueGeoRawRow[] | undefined | null,
  context: RevenueGeoContext = {}
): RevenueGeoSummary {
  // A row with no country code is unusable for attribution. A row with no views
  // but real revenue is NOT — rule 3 above.
  const cleaned = (raw ?? []).filter(
    (r) => r.country && (r.views > 0 || r.estimatedRevenue !== 0 || r.adImpressions > 0)
  );

  const attributedViews = cleaned.reduce((s, r) => s + r.views, 0);
  const attributedRevenue = cleaned.reduce((s, r) => s + r.estimatedRevenue, 0);
  const totalAdRevenue = cleaned.reduce((s, r) => s + r.estimatedAdRevenue, 0);
  const totalPremiumRevenue = cleaned.reduce((s, r) => s + r.estimatedRedPartnerRevenue, 0);
  const totalAdImpressions = cleaned.reduce((s, r) => s + r.adImpressions, 0);
  const totalMonetizedPlaybacks = cleaned.reduce((s, r) => s + r.monetizedPlaybacks, 0);

  // Shares divide by the attributed sums on purpose: within the country table
  // the numerator and denominator come from the same (partial) accounting, so
  // the DISTRIBUTION is sound even though the totals are not.
  const rows: RevenueGeoRow[] = cleaned
    .map((r) => {
      const viewSharePct = attributedViews > 0 ? (r.views / attributedViews) * 100 : 0;
      const revenueSharePct =
        attributedRevenue !== 0 ? (r.estimatedRevenue / attributedRevenue) * 100 : 0;
      return {
        ...r,
        countryName: countryName(r.country),
        flag: flagEmoji(r.country),
        viewSharePct,
        revenueSharePct,
        rpm: r.views > 0 ? (r.estimatedRevenue / r.views) * 1000 : null,
        valueIndex: r.views > 0 && viewSharePct > 0 ? revenueSharePct / viewSharePct : null,
      };
    })
    .sort((a, b) => b.estimatedRevenue - a.estimatedRevenue);

  // Rule 4: rates need the undimensioned totals. Fall back only with a flag.
  const vt = context.videoTotals;
  const rpmBasis: RevenueGeoSummary['rpmBasis'] = vt ? 'video-totals' : 'country-attributed';
  const totalViews = vt ? vt.views : attributedViews;
  const totalRevenue = vt ? vt.estimatedRevenue : attributedRevenue;
  const monetizedPlaybacks = vt ? vt.monetizedPlaybacks : totalMonetizedPlaybacks;

  // Rule 1: weighted, not an average of the per-country rates.
  // Rule 2: views is the denominator, not monetized playbacks.
  const rpm = totalViews > 0 ? (totalRevenue / totalViews) * 1000 : 0;
  const channelRpm = context.channelRpm;

  return {
    rows,
    attributedViews,
    attributedRevenue,
    totalViews,
    totalRevenue,
    totalAdRevenue,
    totalPremiumRevenue,
    totalAdImpressions,
    totalMonetizedPlaybacks,
    rpm,
    rpmBasis,
    monetizedPlaybackRate: totalViews > 0 ? monetizedPlaybacks / totalViews : 0,
    servingAds: totalAdImpressions > 0,
    countryCount: rows.length,
    topRevenueCountry: rows[0] ?? null,
    rpmIndex: channelRpm && channelRpm > 0 ? rpm / channelRpm : null,
  };
}
