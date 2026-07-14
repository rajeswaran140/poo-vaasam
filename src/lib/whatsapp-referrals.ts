/**
 * The WhatsApp REFERRAL COEFFICIENT — the return leg of the share loop.
 *
 * Every other share metric in this app counts the OUTBOUND half: clicks on our
 * own share buttons (`trackShare` → /api/events) or YouTube's native Share
 * dialog (`fetchVideoShares`). None of them can answer the only question that
 * decides whether the WhatsApp strategy is working:
 *
 *     when someone forwards a song, does anyone actually come back?
 *
 *     whatsappPer1k = WhatsApp-referred YouTube views per 1,000 channel views
 *
 * Measured on 2026-07-14 over Jun 1 – Jul 11 it sat at ~12 per 1,000 (1.2%) and
 * was FLAT (12.1 → 12.3 → 12.6 → 11.8) across weeks in which channel views
 * nearly tripled — i.e. WhatsApp forwarding is currently a fixed echo of reach,
 * not an independent source of it. A self-sustaining loop needs >1,000 per
 * 1,000. That flat baseline is the thing any WhatsApp work has to move, which is
 * why it belongs in the product rather than in a one-off script.
 *
 * Gotcha this module exists to absorb: YouTube reports WhatsApp under SEVERAL
 * `insightTrafficSourceDetail` labels — "WhatsApp", "whatsapp.com" and
 * "WhatsApp Business" all appear in the live data. Counting only the first
 * undercounts the coefficient by ~40%.
 */

import {
  fetchChannelAnalyticsSnapshot,
  fetchExternalReferrers,
  isYouTubeAnalyticsConfigured,
  type ReferrerRow,
  type Result,
} from '@/lib/youtube-analytics';

export interface ReferralSource extends ReferrerRow {
  isWhatsApp: boolean;
}

export interface ReferralCoefficient {
  /** Days in the reported window (both reports use the same one, or the ratio is nonsense). */
  windowDays: number;
  /** Denominator: all channel views in the window. */
  channelViews: number;
  /** WhatsApp-referred views (all label variants merged). */
  whatsappViews: number;
  /** Every EXT_URL-referred view, WhatsApp included. */
  externalViews: number;
  /** THE KPI — WhatsApp views returned per 1,000 channel views (1 dp). */
  whatsappPer1k: number;
  /** How much of our external traffic is WhatsApp, as a % (1 dp). */
  whatsappShareOfExternal: number;
  /** Full external breakdown, ranked by views. */
  sources: ReferralSource[];
}

/**
 * WhatsApp shows up as "WhatsApp", "whatsapp.com", "WhatsApp Business" and
 * (on web) "web.whatsapp.com". Substring-match rather than enumerate, so a new
 * label variant doesn't silently drop out of the count.
 */
export function isWhatsAppSource(source: string): boolean {
  return /whatsapp/i.test(source);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pure: join the EXT_URL breakdown with channel views → the coefficient. */
export function computeReferralCoefficient(input: {
  windowDays: number;
  channelViews: number;
  referrers: ReferrerRow[];
}): ReferralCoefficient {
  const { windowDays, channelViews, referrers } = input;

  const sources: ReferralSource[] = [...referrers]
    .map((r) => ({ ...r, isWhatsApp: isWhatsAppSource(r.source) }))
    .sort((a, b) => b.views - a.views);

  const whatsappViews = sources.reduce((sum, s) => sum + (s.isWhatsApp ? s.views : 0), 0);
  const externalViews = sources.reduce((sum, s) => sum + s.views, 0);

  return {
    windowDays,
    channelViews,
    whatsappViews,
    externalViews,
    whatsappPer1k: channelViews > 0 ? round1((whatsappViews / channelViews) * 1000) : 0,
    whatsappShareOfExternal: externalViews > 0 ? round1((whatsappViews / externalViews) * 100) : 0,
    sources,
  };
}

/**
 * Fetch the coefficient. Both upstream reports are pulled over the SAME window —
 * a mismatched numerator and denominator would produce a plausible-looking but
 * meaningless ratio, so neither is allowed to degrade to a default: if either
 * report fails we fail, rather than reporting a 0 that reads like "nobody
 * shared".
 */
export async function fetchReferralCoefficient(daysBack = 28): Promise<Result<ReferralCoefficient>> {
  if (!isYouTubeAnalyticsConfigured()) {
    return { ok: false, error: 'YouTube Analytics OAuth not configured' };
  }

  const [snapshot, referrers] = await Promise.all([
    fetchChannelAnalyticsSnapshot(daysBack),
    fetchExternalReferrers(daysBack),
  ]);

  if (!snapshot.ok) return snapshot;
  if (!referrers.ok) return referrers;

  return {
    ok: true,
    data: computeReferralCoefficient({
      windowDays: daysBack,
      channelViews: snapshot.data.views,
      referrers: referrers.data,
    }),
  };
}
