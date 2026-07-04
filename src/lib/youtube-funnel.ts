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
/** Minimum per-video views before a song's subs-per-view rate is trustworthy. */
export const MIN_VIEWS_PER_SONG = 50;

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
  views: number;
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

export interface FunnelInput {
  days: number;
  channel: FunnelChannelTotals;
  trafficSources: FunnelTrafficRow[];
  playlist: FunnelPlaylistTotals | null;
  videos: FunnelVideoRow[];
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
  };
  returned: { subscriberSourceSharePct: number; viewsPerViewer: number | null };
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
  const viewsPerPlaylistStart = playlist ? round1(playlist.viewsPerPlaylistStart) : 0;
  const averageTimeInPlaylistSeconds = playlist ? Math.round(playlist.averageTimeInPlaylistSeconds) : 0;
  const playlistShareOfViewsPct = round1(pct(playlist?.views ?? 0, totalViews) ?? 0);

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

  // --- per-song conversion leaderboard (min-views gated) ---
  const topConverters: SongConversion[] = videos
    .filter((v) => v.views >= MIN_VIEWS_PER_SONG)
    .map((v) => ({
      videoId: v.videoId,
      views: v.views,
      averageViewPercentage: round1(v.averageViewPercentage),
      subscribersGained: v.subscribersGained,
      subsPer1000Views: v.views > 0 ? round1((v.subscribersGained / v.views) * 1000) : 0,
    }))
    .sort((a, b) => b.subsPer1000Views - a.subsPer1000Views || b.views - a.views)
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
      note: 'Views per playlist start — songs watched per playlist session.',
    },
    {
      key: 'RETURNED',
      label: 'Returned',
      value: subscriberSourceSharePct,
      unit: '% of views',
      proxy: true,
      note: 'Subscriber/notification traffic share — proxy for loyal/returning viewers (true new-vs-returning is Studio-only).',
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
      ratePct: viewsPerPlaylistStart,
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
        stageKey: 'WATCHED_2ND_SONG',
        health: viewsPerPlaylistStart / SONGS_PER_SESSION_FLOOR,
        reason: `Only ${viewsPerPlaylistStart} songs per playlist session — they don't roll into a 2nd song (playlist ordering / end screens).`,
      },
      {
        stageKey: 'SUBSCRIBED',
        health: subsPer1000Views / SUBS_PER_1000_FLOOR,
        reason: `Just ${subsPer1000Views} subs per 1,000 views — watchers aren't converting (subscribe CTA / watermark / end screen).`,
      },
    ];
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
    leakiestStage,
    topConverters,
  });

  return {
    days,
    hasEnoughData,
    stages,
    conversions,
    trafficMix,
    secondSong: { viewsPerPlaylistStart, averageTimeInPlaylistSeconds, playlistShareOfViewsPct },
    returned: { subscriberSourceSharePct, viewsPerViewer },
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
  leakiestStage: FunnelReport['leakiestStage'];
  topConverters: SongConversion[];
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
  if (r.viewsPerPlaylistStart >= SONGS_PER_SESSION_FLOOR) {
    out.push(`Playlists are working (${r.viewsPerPlaylistStart} songs/session) — keep seeding new songs into the ordered playlists.`);
  }
  return out;
}
