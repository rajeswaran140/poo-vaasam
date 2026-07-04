/**
 * Viewer Conversion Funnel — models the YouTube audience as a SaaS-style funnel:
 *
 *   DISCOVERED → WATCHED → WATCHED_2ND_SONG → RETURNED → SUBSCRIBED
 *
 * YouTube Analytics cannot identify individual viewers, so this is a
 * COHORT/AGGREGATE model built from views, traffic-source, playlist and
 * subscriber metrics. Every helper here is PURE + unit-tested; the network
 * fetch that assembles the input lives in lib/youtube-analytics (fetchFunnelData).
 *
 * Honesty guards (do not fake what the API can't give):
 *  - Impressions / CTR (the very top of DISCOVERED) are Studio-only — we use
 *    `views` as the closest API proxy and label it as such.
 *  - True new-vs-returning viewers are Studio-only — RETURNED is proxied by the
 *    SUBSCRIBER traffic share (+ views-per-unique-viewer when available).
 *  - Recommendations are sample-gated (MIN_TOTAL_VIEWS) so a tiny window never
 *    invents a pattern.
 */

/** Minimum window views before we surface a leak diagnosis / recommendations. */
export const MIN_TOTAL_VIEWS = 100;
/** Minimum per-video views before a song's subs-per-view rate is worth showing. */
export const MIN_VIEWS_PER_SONG = 300;
/**
 * Pseudo-view prior for Bayesian shrinkage of the per-song conversion rate:
 * a song's rate is pulled toward the cohort mean by this many "prior" views, so
 * a 6-subs-from-500-views song can't out-rank a 16-from-2,000 song on noise.
 */
const SHRINK_PRIOR_VIEWS = 1000;

// Benchmarks used only for the leak diagnosis (rough, channel-stage-appropriate).
const RETENTION_FLOOR_PCT = 25; // avg view % below this = a WATCHED (hook) leak
const SONGS_PER_SESSION_FLOOR = 1.5; // viewsPerPlaylistStart below this = 2nd-song leak
const SUBS_PER_1000_FLOOR = 5; // <5 subs / 1000 views (0.5%) = a SUBSCRIBE leak

export type FunnelStageKey =
  | 'DISCOVERED'
  | 'WATCHED'
  | 'WATCHED_2ND_SONG'
  | 'RETURNED'
  | 'SUBSCRIBED';

// ---- Raw input (assembled by the fetcher; all API-native numbers) ----------

export interface FunnelChannelTotals {
  views: number;
  watchMinutes: number;
  averageViewPercentage: number; // 0..100
  subscribersGained: number;
  subscribersLost: number;
  uniqueViewers: number | null; // `viewers` metric; null when unavailable
}

export interface FunnelTrafficRow {
  source: string; // insightTrafficSourceType code, e.g. RELATED_VIDEO
  views: number;
  watchMinutes: number;
}

export interface FunnelPlaylistTotals {
  playlistStarts: number;
  viewsPerPlaylistStart: number; // songs watched per playlist session
  averageTimeInPlaylistSeconds: number;
}

export interface FunnelVideoRow {
  videoId: string;
  views: number;
  averageViewPercentage: number;
  subscribersGained: number;
}

/** Views/watch split by whether the viewer was subscribed at watch time. */
export interface FunnelSubscribedStatus {
  subscribed: { views: number; watchMinutes: number };
  unsubscribed: { views: number; watchMinutes: number };
}

/** A video that sends suggested-video (RELATED_VIDEO) traffic to the channel. */
export interface FunnelDiscoverySource {
  videoId: string;
  views: number;
}

export interface FunnelInput {
  days: number;
  channel: FunnelChannelTotals;
  trafficSources: FunnelTrafficRow[];
  playlist: FunnelPlaylistTotals | null;
  videos: FunnelVideoRow[];
  // Phase 2 (best-effort; null/[] when unavailable):
  subscribedStatus?: FunnelSubscribedStatus | null; // real returning-viewer measure
  discoverySources?: FunnelDiscoverySource[]; // song→song suggested-traffic feeders
}

// ---- Output ----------------------------------------------------------------

export interface FunnelStage {
  key: FunnelStageKey;
  label: string;
  value: number; // headline KPI for the stage (unit-specific, NOT a subset count)
  unit: string;
  proxy: boolean; // true when it's a proxy rather than a direct measure
  note: string;
}

export interface ConversionRate {
  key: string;
  label: string;
  ratePct: number | null; // null when the denominator is 0
  note?: string;
}

export interface TrafficMixRow {
  source: string;
  label: string;
  views: number;
  sharePct: number;
  internal: boolean; // arrived via an on-YouTube surface you own/influence
}

export interface SongConversion {
  videoId: string;
  views: number;
  averageViewPercentage: number;
  subscribersGained: number;
  subsPer1000Views: number;
}

export interface FunnelReport {
  days: number;
  hasEnoughData: boolean;
  stages: FunnelStage[];
  conversions: ConversionRate[];
  trafficMix: TrafficMixRow[];
  secondSong: {
    viewsPerPlaylistStart: number;
    averageTimeInPlaylistSeconds: number;
    playlistShareOfViewsPct: number;
    measured: boolean; // false when there's no playlist-session data this window
  };
  returned: {
    subscriberSourceSharePct: number;
    viewsPerViewer: number | null;
    /** Real returning measure: share of views from already-subscribed viewers
     *  (from the subscribedStatus dimension). null when unavailable. */
    subscribedViewSharePct: number | null;
  };
  /** Songs whose suggested-video traffic feeds the rest of the catalogue. */
  discoveryEngines: { videoId: string; views: number; sharePct: number }[];
  subscribe: {
    subscribersGained: number;
    subscribersLost: number;
    netSubscribers: number;
    subsPer1000Views: number;
  };
  topConverters: SongConversion[];
  leakiestStage: { stageKey: FunnelStageKey; reason: string } | null;
  recommendations: string[];
}

// Traffic-source code → friendly label + whether it's an on-YouTube surface you
// own/influence (internal ecosystem) vs external/cold discovery.
const TRAFFIC: Record<string, { label: string; internal: boolean }> = {
  RELATED_VIDEO: { label: 'Suggested videos', internal: true },
  PLAYLIST: { label: 'Playlists', internal: true },
  YT_CHANNEL: { label: 'Channel page', internal: true },
  SUBSCRIBER: { label: 'Subscriptions / home feed', internal: true },
  NOTIFICATION: { label: 'Notifications', internal: true },
  END_SCREEN: { label: 'End screens', internal: true },
  SHORTS: { label: 'Shorts feed', internal: true },
  YT_OTHER_PAGE: { label: 'Other YouTube pages', internal: true },
  HASHTAGS: { label: 'Hashtags', internal: true },
  ANNOTATION: { label: 'Cards / annotations', internal: true },
  CAMPAIGN_CARD: { label: 'Campaign cards', internal: true },
  YT_SEARCH: { label: 'YouTube search', internal: false },
  EXT_URL: { label: 'External sites', internal: false },
  NO_LINK_OTHER: { label: 'Direct / unknown', internal: false },
  NO_LINK_EMBEDDED: { label: 'Embedded players', internal: false },
  ADVERTISING: { label: 'Ads', internal: false },
  PROMOTED: { label: 'Promoted', internal: false },
};

export function labelTrafficSource(code: string): { label: string; internal: boolean } {
  return TRAFFIC[code] ?? { label: code || 'Unknown', internal: false };
}

const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Build the funnel report from assembled raw analytics. Pure + deterministic. */
export function computeFunnel(input: FunnelInput): FunnelReport {
  const { days, channel, trafficSources, playlist, videos } = input;
  const totalViews = channel.views;

  // --- traffic mix (DISCOVERED breakdown) ---
  const trafficTotal = trafficSources.reduce((s, r) => s + r.views, 0);
  const trafficMix: TrafficMixRow[] = trafficSources
    .filter((r) => r.views > 0)
    .map((r) => {
      const meta = labelTrafficSource(r.source);
      return {
        source: r.source,
        label: meta.label,
        views: r.views,
        sharePct: round1(pct(r.views, trafficTotal) ?? 0),
        internal: meta.internal,
      };
    })
    .sort((a, b) => b.views - a.views);
  const internalDiscoveryPct = round1(
    pct(
      trafficMix.filter((r) => r.internal).reduce((s, r) => s + r.views, 0),
      trafficTotal
    ) ?? 0
  );

  // --- WATCHED_2ND_SONG (playlist multi-song consumption) ---
  // "Measured" only when the window actually had playlist sessions — otherwise
  // viewsPerPlaylistStart is 0 by absence, NOT a real leak (guards the diagnosis).
  const playlistMeasured = !!playlist && playlist.playlistStarts > 0;
  const viewsPerPlaylistStart = playlistMeasured ? round1(playlist!.viewsPerPlaylistStart) : 0;
  const averageTimeInPlaylistSeconds = playlistMeasured ? Math.round(playlist!.averageTimeInPlaylistSeconds) : 0;
  // Entry-via-playlist share = the PLAYLIST traffic source (how many viewers
  // arrived through a playlist), not the narrower in-session playlistViews metric.
  const playlistSourceViews = trafficSources.find((r) => r.source === 'PLAYLIST')?.views ?? 0;
  const playlistShareOfViewsPct = round1(pct(playlistSourceViews, trafficTotal) ?? 0);

  // --- RETURNED (subscriber-source share + repeat-view ratio proxies) ---
  const subscriberViews = trafficSources
    .filter((r) => r.source === 'SUBSCRIBER' || r.source === 'NOTIFICATION')
    .reduce((s, r) => s + r.views, 0);
  const subscriberSourceSharePct = round1(pct(subscriberViews, trafficTotal) ?? 0);
  const viewsPerViewer =
    channel.uniqueViewers && channel.uniqueViewers > 0
      ? round1(totalViews / channel.uniqueViewers)
      : null;

  // --- SUBSCRIBED ---
  const netSubscribers = channel.subscribersGained - channel.subscribersLost;
  const subsPer1000Views = totalViews > 0 ? round1((channel.subscribersGained / totalViews) * 1000) : 0;

  // --- per-song conversion leaderboard (min-views gated, shrinkage-ranked) ---
  const gatedVideos = videos.filter((v) => v.views >= MIN_VIEWS_PER_SONG);
  const cohortViews = gatedVideos.reduce((s, v) => s + v.views, 0);
  const cohortSubs = gatedVideos.reduce((s, v) => s + v.subscribersGained, 0);
  const cohortRatePerView = cohortViews > 0 ? cohortSubs / cohortViews : 0;
  // Shrunk subs-per-view — pulls a small sample toward the cohort mean so the
  // ranking reflects a trustworthy rate, not a lucky 2-subs-from-200-views spike.
  const shrunkRate = (subs: number, views: number) =>
    (subs + cohortRatePerView * SHRINK_PRIOR_VIEWS) / (views + SHRINK_PRIOR_VIEWS);
  const topConverters: SongConversion[] = gatedVideos
    .map((v) => ({
      videoId: v.videoId,
      views: v.views,
      averageViewPercentage: round1(v.averageViewPercentage),
      subscribersGained: v.subscribersGained,
      subsPer1000Views: v.views > 0 ? round1((v.subscribersGained / v.views) * 1000) : 0,
    }))
    // Rank by the shrinkage-adjusted rate (stable vs noise); DISPLAY the raw rate.
    .sort(
      (a, b) =>
        shrunkRate(b.subscribersGained, b.views) - shrunkRate(a.subscribersGained, a.views) ||
        b.views - a.views
    )
    .slice(0, 5);

  // --- Phase 2: real returning measure + song→song discovery engines ---
  const ss = input.subscribedStatus ?? null;
  const subscribedViewSharePct = ss
    ? round1(pct(ss.subscribed.views, ss.subscribed.views + ss.unsubscribed.views) ?? 0)
    : null;
  const discSources = input.discoverySources ?? [];
  const discTotal = discSources.reduce((s, r) => s + r.views, 0);
  const discoveryEngines = discSources
    .filter((r) => r.views > 0)
    .map((r) => ({ videoId: r.videoId, views: r.views, sharePct: round1(pct(r.views, discTotal) ?? 0) }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  // --- stages (headline KPI per stage, honestly labelled) ---
  const stages: FunnelStage[] = [
    {
      key: 'DISCOVERED',
      label: 'Discovered',
      value: totalViews,
      unit: 'views',
      proxy: true,
      note: 'Impressions/CTR are Studio-only; views is the closest API proxy.',
    },
    {
      key: 'WATCHED',
      label: 'Watched',
      value: round1(channel.averageViewPercentage),
      unit: '% avg view',
      proxy: false,
      note: 'Average view percentage — the activation-quality gate (first 15s).',
    },
    {
      key: 'WATCHED_2ND_SONG',
      label: 'Watched a 2nd song',
      value: viewsPerPlaylistStart,
      unit: 'songs/session',
      proxy: false,
      note: playlistMeasured
        ? 'Views per playlist start — songs watched per playlist session.'
        : 'No playlist-session data in this window yet.',
    },
    {
      key: 'RETURNED',
      label: 'Returned',
      value: subscribedViewSharePct ?? subscriberSourceSharePct,
      unit: '% of views',
      // A real measure when subscribedStatus is available, else the traffic proxy.
      proxy: subscribedViewSharePct == null,
      note:
        subscribedViewSharePct != null
          ? 'Share of views from already-subscribed viewers (subscribedStatus) — a real returning measure.'
          : 'Subscriber/notification traffic share — proxy for loyal/returning viewers (true new-vs-returning is Studio-only).',
    },
    {
      key: 'SUBSCRIBED',
      label: 'Subscribed',
      value: channel.subscribersGained,
      unit: 'subs',
      proxy: false,
      note: `Net ${netSubscribers >= 0 ? '+' : ''}${netSubscribers} after ${channel.subscribersLost} lost.`,
    },
  ];

  const conversions: ConversionRate[] = [
    {
      key: 'internal_discovery',
      label: 'On-YouTube discovery share',
      ratePct: internalDiscoveryPct,
      note: 'Views arriving via suggested/playlist/subscriptions vs cold external.',
    },
    {
      key: 'watch_to_2nd_song',
      label: 'Songs per playlist session',
      ratePct: playlistMeasured ? viewsPerPlaylistStart : null,
      note: 'Not a %, a count — >1 means the playlist carries them to another song.',
    },
    {
      key: 'watch_to_subscribe',
      label: 'Watch → Subscribe',
      ratePct: totalViews > 0 ? round1((channel.subscribersGained / totalViews) * 100) : null,
      note: `${subsPer1000Views} subscribers per 1,000 views.`,
    },
  ];

  // --- leak diagnosis: the stage furthest below its benchmark ---
  const hasEnoughData = totalViews >= MIN_TOTAL_VIEWS;
  let leakiestStage: FunnelReport['leakiestStage'] = null;
  if (hasEnoughData) {
    const candidates: Array<{ stageKey: FunnelStageKey; health: number; reason: string }> = [
      {
        stageKey: 'WATCHED',
        health: channel.averageViewPercentage / RETENTION_FLOOR_PCT,
        reason: `Average view % is ${round1(channel.averageViewPercentage)} — viewers leave early (fix the first ~15s hook).`,
      },
      {
        stageKey: 'SUBSCRIBED',
        health: subsPer1000Views / SUBS_PER_1000_FLOOR,
        reason: `Just ${subsPer1000Views} subs per 1,000 views — watchers aren't converting (subscribe CTA / watermark / end screen).`,
      },
    ];
    // Only judge the 2nd-song stage when we actually measured playlist sessions —
    // never flag it as a leak from an absent/failed playlist report.
    if (playlistMeasured) {
      candidates.push({
        stageKey: 'WATCHED_2ND_SONG',
        health: viewsPerPlaylistStart / SONGS_PER_SESSION_FLOOR,
        reason: `Only ${viewsPerPlaylistStart} songs per playlist session — they don't roll into a 2nd song (playlist ordering / end screens).`,
      });
    }
    const worst = candidates.filter((c) => c.health < 1).sort((a, b) => a.health - b.health)[0];
    if (worst) leakiestStage = { stageKey: worst.stageKey, reason: worst.reason };
  }

  const recommendations = buildRecommendations({
    hasEnoughData,
    totalViews,
    days,
    internalDiscoveryPct,
    viewsPerPlaylistStart,
    subsPer1000Views,
    subscriberSourceSharePct,
    subscribedViewSharePct,
    leakiestStage,
    topConverters,
    discoveryEngines,
  });

  return {
    days,
    hasEnoughData,
    stages,
    conversions,
    trafficMix,
    secondSong: { viewsPerPlaylistStart, averageTimeInPlaylistSeconds, playlistShareOfViewsPct, measured: playlistMeasured },
    returned: { subscriberSourceSharePct, viewsPerViewer, subscribedViewSharePct },
    discoveryEngines,
    subscribe: {
      subscribersGained: channel.subscribersGained,
      subscribersLost: channel.subscribersLost,
      netSubscribers,
      subsPer1000Views,
    },
    topConverters,
    leakiestStage,
    recommendations,
  };
}

function buildRecommendations(r: {
  hasEnoughData: boolean;
  totalViews: number;
  days: number;
  internalDiscoveryPct: number;
  viewsPerPlaylistStart: number;
  subsPer1000Views: number;
  subscriberSourceSharePct: number;
  subscribedViewSharePct: number | null;
  leakiestStage: FunnelReport['leakiestStage'];
  topConverters: SongConversion[];
  discoveryEngines: { videoId: string; views: number; sharePct: number }[];
}): string[] {
  if (r.totalViews === 0) return ['No views in this window yet — nothing to model.'];
  if (!r.hasEnoughData) {
    return [`Only ${r.totalViews} views in the last ${r.days}d — need ≥${MIN_TOTAL_VIEWS} before the funnel is trustworthy.`];
  }
  const out: string[] = [];
  if (r.leakiestStage) out.push(`Biggest leak: ${r.leakiestStage.reason}`);
  out.push(
    `${r.internalDiscoveryPct}% of views come from on-YouTube surfaces (suggested/playlist/subs) — the algorithm is doing the discovery; ${r.subscriberSourceSharePct}% is your returning subscriber base.`
  );
  const best = r.topConverters[0];
  if (best) {
    out.push(
      `Your best converter is ${best.videoId} at ${best.subsPer1000Views} subs/1,000 views — cross-link it from end screens and lead playlists with it.`
    );
  }
  // Cross-promotion play: point your biggest discovery engine at your best converter.
  const engine = r.discoveryEngines[0];
  if (engine && best && engine.videoId !== best.videoId) {
    out.push(
      `Cross-promo: your top discovery engine ${engine.videoId} feeds ${engine.sharePct}% of suggested traffic — end-screen it to your best converter ${best.videoId}.`
    );
  }
  if (r.subscribedViewSharePct != null && r.subscribedViewSharePct < 10) {
    out.push(
      `Only ${r.subscribedViewSharePct}% of views are from already-subscribed viewers — you're discovery-driven, so converting new viewers to subs is the whole game.`
    );
  }
  if (r.viewsPerPlaylistStart >= SONGS_PER_SESSION_FLOOR) {
    out.push(`Playlists are working (${r.viewsPerPlaylistStart} songs/session) — keep seeding new songs into the ordered playlists.`);
  }
  return out;
}
