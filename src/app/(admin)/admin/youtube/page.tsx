/**
 * /admin/youtube — YouTube analytics dashboard.
 *
 * A purely YouTube-focused view: a channel snapshot (subs, total views, video
 * count), GA4 site signals, owner-scoped Analytics + AI recommendations, and
 * an interactive per-video panel. It does NOT cross-reference the site's audio
 * song catalogue — this page is about the channel, not about which songs are
 * published on the site.
 *
 * Server component. Reads happen here; the page itself is admin-gated via
 * the (admin) layout, so no client-side auth check is needed.
 */

import { SITE, isYouTubeVideosConfigured } from '@/config/site';
import {
  fetchChannelStats,
  fetchChannelVideoStats,
  isYouTubeApiConfigured,
} from '@/lib/youtube-api';
import {
  fetchSubscribeClicksBySource,
  fetchTrafficSnapshot,
  fetchAudioPlays,
  fetchYouTubeOpens,
  isGA4Configured,
  type EngagementData,
  type Result,
} from '@/lib/ga4-api';
import {
  fetchChannelAnalyticsSnapshot,
  fetchVideoAnalytics,
  fetchDailySeries,
  isYouTubeAnalyticsConfigured,
} from '@/lib/youtube-analytics';
import { buildDigest, type Digest } from '@/lib/youtube-digest';
import { YtRecsRepository } from '@/infrastructure/database/YtRecsRepository';
import { RefreshRecsButton } from '@/components/admin/RefreshRecsButton';
import { RefreshThumbnailsButton } from '@/components/admin/RefreshThumbnailsButton';
import { YouTubeVideosPanel } from '@/components/admin/YouTubeVideosPanel';
import { RetentionInsightPanel } from '@/components/admin/RetentionInsightPanel';
import { PerSongDeepDive } from '@/components/admin/PerSongDeepDive';
import { SongCockpit } from '@/components/admin/SongCockpit';
import { SongLifecycleReportPanel } from '@/components/admin/SongLifecycleReportPanel';
import { SearchScorecardPanel } from '@/components/admin/SearchScorecardPanel';
import { TopSongMonitorPanel } from '@/components/admin/TopSongMonitorPanel';
import { SharesPanel } from '@/components/admin/SharesPanel';
import { ReferralCoefficientPanel } from '@/components/admin/ReferralCoefficientPanel';
import { FunnelInsightPanel } from '@/components/admin/FunnelInsightPanel';
import { LazyMount } from '@/components/admin/LazyMount';
import { mergeVideoRows, pickRetentionBenchmark } from '@/lib/youtube-dashboard';

const ANALYTICS_DAYS = 28;

// Fetch at request time, not at build. Amplify's SSR runtime doesn't run ISR
// (the incremental cache isn't shared across Lambdas), so a `revalidate` route
// freezes at build — which is how a build-time Analytics 401 (e.g. a stale
// refresh token at that moment) got baked in and stuck. Dynamic + the inlined
// OAuth/GA4 creds (next.config.ts) means the dashboard refreshes its own access
// token each request and self-heals. Admin-only, low traffic — latency is fine.
export const dynamic = 'force-dynamic';

const numberFmt = new Intl.NumberFormat('en-US');

export default async function YouTubeAdminPage() {
  if (!isYouTubeVideosConfigured()) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-6 text-amber-900 dark:text-amber-200">
        YouTube channel not configured. Set <code>SITE.youtube.channelId</code> in <code>src/config/site.ts</code>.
      </div>
    );
  }

  if (!isYouTubeApiConfigured()) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">YouTube Analytics</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-6 text-amber-900 dark:text-amber-200">
          <p className="font-semibold mb-2">YOUTUBE_API_KEY is not set.</p>
          <p className="text-sm">
            Add a YouTube Data API v3 key to Amplify environment variables (server-only,
            <em> not</em> NEXT_PUBLIC_) and redeploy. The dashboard renders as soon as the
            key is configured.
          </p>
        </div>
      </div>
    );
  }

  const ga4On = isGA4Configured();
  const ytaOn = isYouTubeAnalyticsConfigured();

  // Fetch the channel once — its uploadsPlaylistId is reused by the video-stats
  // call below (avoids a duplicate channels.list). Without it the page can't render.
  const channel = await fetchChannelStats(SITE.youtube.channelId);
  if (!channel) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 p-6 text-red-900 dark:text-red-200">
        Couldn&apos;t reach the YouTube Data API. Check the key, the channel ID, and the project&apos;s daily quota.
      </div>
    );
  }

  // Everything else fans out in parallel (each helper is failure-isolated —
  // Result objects or null — so one failure can't blank the page). cachedRecs
  // is in the fan-out too, not a serial await afterwards.
  const [videos, ga4ClicksRes, ga4TrafficRes, ga4AudioRes, ga4YouTubeRes, ytaChannelRes, ytaVideosRes, dailyRes, cachedRecs] = await Promise.all([
    fetchChannelVideoStats(SITE.youtube.channelId, 200, { channel }),
    ga4On ? fetchSubscribeClicksBySource(ANALYTICS_DAYS) : Promise.resolve(null),
    ga4On ? fetchTrafficSnapshot(ANALYTICS_DAYS) : Promise.resolve(null),
    ga4On ? fetchAudioPlays(ANALYTICS_DAYS) : Promise.resolve(null),
    ga4On ? fetchYouTubeOpens(ANALYTICS_DAYS) : Promise.resolve(null),
    ytaOn ? fetchChannelAnalyticsSnapshot(ANALYTICS_DAYS) : Promise.resolve(null),
    ytaOn ? fetchVideoAnalytics(ANALYTICS_DAYS) : Promise.resolve(null),
    ytaOn ? fetchDailySeries(ANALYTICS_DAYS) : Promise.resolve(null),
    new YtRecsRepository().get(SITE.youtube.channelId).catch(() => null),
  ]);

  // Unwrap GA4 Results — if either failed, render its .error verbatim on the
  // dashboard so we can see "PERMISSION_DENIED" / "invalid dimension" etc.
  // instead of an indistinguishable empty state.
  const clicksData = ga4ClicksRes?.ok ? ga4ClicksRes.data : null;
  const clicksError = ga4ClicksRes && !ga4ClicksRes.ok ? ga4ClicksRes.error : null;
  const traffic = ga4TrafficRes?.ok ? ga4TrafficRes.data : null;
  const trafficError = ga4TrafficRes && !ga4TrafficRes.ok ? ga4TrafficRes.error : null;
  const totalSubscribeClicks = clicksData?.total ?? 0;
  const clickRows = clicksData?.rows ?? [];
  const maxSubscribeClicks = Math.max(1, ...clickRows.map((r) => r.eventCount));

  // YouTube Analytics + AI recommendations — best-effort, page renders
  // regardless. AI call only fires when BOTH analytics queries succeed so
  // Claude isn't asked to reason about an empty dataset.
  const ytaChannel = ytaChannelRes?.ok ? ytaChannelRes.data : null;
  const ytaVideos = ytaVideosRes?.ok ? ytaVideosRes.data : [];
  // Weekly digest + anomaly signal (week-over-week growth + stall/real-drop
  // classification) from the daily series. Built server-side; pure math.
  const dailySeries = dailyRes?.ok ? dailyRes.data : null;
  const digest = dailySeries && dailySeries.length > 0 ? buildDigest(dailySeries, ytaVideos) : null;
  // Comprehensive per-video rows for the interactive panel: public Data-API
  // counts + owner Analytics metrics, merged once on the server. The panel
  // re-queries Analytics client-side when the date range changes.
  const videoRows = mergeVideoRows(videos, ytaVideos);
  // Benchmark for retention comparison = the best-retention REGULAR video
  // (Shorts excluded — they hold ~90%+ by virtue of being short and would make
  // every long-form hook look weak). Falls back to absolute thresholds when no
  // regular video has retention data yet.
  const benchmarkRow = pickRetentionBenchmark(videoRows);
  const retentionVideos = videoRows.map((r) => ({ id: r.id, title: r.title, durationSeconds: r.durationSeconds }));
  const ytaError = ytaChannelRes && !ytaChannelRes.ok ? ytaChannelRes.error : null;
  const titlesByVideoId = Object.fromEntries(videos.map((v) => [v.id, v.title]));
  // cachedRecs came from the fan-out above. Recommendations are generated on
  // demand (admin "Refresh") and cached — NEVER an LLM call in this render path
  // (an Anthropic call can't reliably fit the Amplify ~30s request ceiling).

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">YouTube Analytics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {channel.title} ·{' '}
            <a
              href={SITE.youtube.channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-600 hover:underline"
            >
              Open channel <span aria-hidden>↗</span>
            </a>
          </p>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">YouTube Data API cached ~1h · AI recs on demand</p>
      </header>

      {/* Snapshot cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Subscribers" value={numberFmt.format(channel.subscriberCount)} />
        <StatCard label="Total views" value={numberFmt.format(channel.viewCount)} />
        <StatCard label="Videos published" value={numberFmt.format(channel.videoCount)} />
      </section>

      {/* Weekly digest + anomaly signal */}
      {digest && <DigestCard digest={digest} />}

      {/* GA4 — site signals */}
      {ga4On ? (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Subscribe CTA performance — the headline Phase 2 card. */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm lg:col-span-2">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Subscribe CTA · last 28 days
                </p>
                <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                  {numberFmt.format(totalSubscribeClicks)} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">clicks</span>
                </p>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Source: GA4 subscribe_click event</p>
            </div>
            {clicksError ? (
              <pre className="overflow-x-auto rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 p-3 text-xs text-red-900 dark:text-red-200">
                {clicksError}
              </pre>
            ) : clicksData?.note === 'dimension-not-registered' ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
                <p className="mb-2">
                  <strong>Custom dimension not registered yet.</strong> Total above is the running count of all <code>subscribe_click</code> events; the per-CTA breakdown will appear once you register the dimension.
                </p>
                <p className="mb-1 text-xs">
                  Register in GA4: <strong>Admin → Custom definitions → Create custom dimension</strong>
                </p>
                <ul className="ml-4 list-disc text-xs">
                  <li>Dimension name: <code>CTA Source</code></li>
                  <li>Scope: <code>Event</code></li>
                  <li>Event parameter: <code>source</code></li>
                </ul>
                <p className="mt-2 text-xs">
                  GA4 only tags events received <em>after</em> registration — breakdowns appear over the following 24–48h.
                </p>
              </div>
            ) : clickRows.length === 0 ? (
              <p className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50 text-sm text-gray-500 dark:text-gray-400">
                No subscribe_click events recorded yet. The event fires on every Subscribe CTA — once visitors click, breakdowns will appear here.
              </p>
            ) : (
              <ul className="space-y-2">
                {clickRows.map((row) => {
                  const pct = Math.round((row.eventCount / maxSubscribeClicks) * 100);
                  return (
                    <li key={row.source} className="text-sm">
                      <div className="mb-1 flex justify-between">
                        <span className="font-medium text-gray-800 dark:text-gray-200">{row.source}</span>
                        <span className="tabular-nums text-gray-600 dark:text-gray-400">{numberFmt.format(row.eventCount)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Traffic snapshot */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Site traffic · last {traffic?.daysBack ?? 28} days
            </p>
            {trafficError ? (
              <pre className="overflow-x-auto rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 p-3 text-xs text-red-900 dark:text-red-200">
                {trafficError}
              </pre>
            ) : traffic ? (
              <div className="space-y-3">
                <TrafficRow label="Users" value={numberFmt.format(traffic.totalUsers)} />
                <TrafficRow label="Sessions" value={numberFmt.format(traffic.sessions)} />
                <TrafficRow label="Pageviews" value={numberFmt.format(traffic.pageViews)} />
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No data yet.</p>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-5 text-sm text-amber-900 dark:text-amber-200">
          <p className="mb-1 font-semibold">GA4 analytics not yet configured</p>
          <p className="text-xs">
            Set <code>GA4_PROPERTY_ID</code> and <code>GA4_SERVICE_ACCOUNT_KEY</code> in Amplify env vars, grant the SA Viewer on the GA4 property, and the &ldquo;Subscribe CTA&rdquo; + &ldquo;Site traffic&rdquo; cards will appear here.
          </p>
        </section>
      )}

      {/* Phase 3 — owner-scoped Analytics + AI recommendations */}
      {ytaOn ? (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Channel-wide totals */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Subscribers · last 28 days
            </p>
            <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {ytaChannel ? `+${numberFmt.format(ytaChannel.subscribersGained)}` : '—'}
              {ytaChannel && ytaChannel.subscribersLost > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                  −{numberFmt.format(ytaChannel.subscribersLost)} lost
                </span>
              )}
            </p>
            {ytaChannel && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {numberFmt.format(ytaChannel.views)} views ·{' '}
                {Math.round(ytaChannel.estimatedMinutesWatched).toLocaleString()} min watched ·{' '}
                avg {Math.round(ytaChannel.averageViewDuration)}s
              </p>
            )}
            {ytaError && (
              <pre className="mt-3 overflow-x-auto rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 p-3 text-xs text-red-900 dark:text-red-200">
                {ytaError}
              </pre>
            )}
          </div>

          {/* Per-video subscriber gains */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Subs gained per video · last 28 days
            </p>
            {ytaVideos.length === 0 ? (
              <p className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50 text-sm text-gray-500 dark:text-gray-400">
                No per-video data yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {ytaVideos.slice(0, 5).map((v) => {
                  const title = titlesByVideoId[v.videoId] ?? v.videoId;
                  return (
                    <li key={v.videoId} className="text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-medium text-gray-800 dark:text-gray-200" title={title}>{title}</span>
                        <span className="tabular-nums text-gray-600 dark:text-gray-400">+{v.subscribersGained}</span>
                      </div>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {numberFmt.format(v.views)} views · avg {Math.round(v.averageViewDuration)}s
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* AI recommendations — cached; regenerated on demand via Refresh (no LLM in render) */}
          <div className="rounded-xl border border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-900/20 p-5 shadow-sm lg:col-span-1">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-orange-700 dark:text-orange-300">
                AI recommendations
              </p>
              <RefreshRecsButton hasExisting={!!cachedRecs && cachedRecs.recommendations.length > 0} />
            </div>
            {!cachedRecs || cachedRecs.recommendations.length === 0 ? (
              <p className="text-sm text-orange-900 dark:text-orange-200">
                None yet — click <strong>Generate recommendations</strong> to analyse the last 28 days.
              </p>
            ) : (
              <>
                <ul className="list-disc space-y-2 pl-4 text-sm text-orange-900 dark:text-orange-200">
                  {cachedRecs.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
                <p className="mt-3 text-[10px] text-orange-700 dark:text-orange-400">
                  Updated {new Date(cachedRecs.generatedAt).toLocaleString()}
                </p>
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-5 text-sm text-amber-900 dark:text-amber-200">
          <p className="mb-1 font-semibold">YouTube Analytics (owner-scoped) not configured</p>
          <p className="text-xs">
            One-time OAuth setup needed: run <code>scripts/get-youtube-refresh-token.ts</code>,
            then set <code>YOUTUBE_OAUTH_CLIENT_ID</code>, <code>YOUTUBE_OAUTH_CLIENT_SECRET</code>,
            and <code>YOUTUBE_REFRESH_TOKEN</code> in Amplify env. Until then per-video subscriber
            gains, retention metrics, and AI recommendations stay hidden.
          </p>
        </section>
      )}

      {/* Engagement — audio plays + YouTube outbound clicks */}
      {ga4On && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <EngagementCard
            title="Top audio plays · last 28 days"
            footnote="audio_play event, by song_title"
            res={ga4AudioRes}
            emptyMessage="No audio plays recorded yet. The event fires whenever a track starts; numbers appear as soon as visitors play songs."
            dimensionRegisterHints={{ name: 'Song Title', param: 'song_title' }}
          />
          <EngagementCard
            title="YouTube outbound · last 28 days"
            footnote="youtube_open event, by destination"
            res={ga4YouTubeRes}
            emptyMessage="No YouTube outbound clicks yet. The event fires when visitors click any non-Subscribe YouTube link (channel/video/embed)."
            dimensionRegisterHints={{ name: 'YouTube Destination', param: 'destination' }}
          />
        </section>
      )}

      {/* LEAD with the at-a-glance diagnosis: the four-metric decision tree across
          the top songs (reduced reach vs CTR vs watch-time). */}
      <TopSongMonitorPanel ytaConfigured={ytaOn} />

      {/* Song shares — per-song native shares + share-rate (WhatsApp lever). */}
      {/* Return leg (did a share bring anyone back?) sits ABOVE outbound intent
          (did anyone click share?) — the coefficient is the one that decides
          whether the WhatsApp strategy is working. */}
      <ReferralCoefficientPanel ytaConfigured={ytaOn} />

      <SharesPanel ytaConfigured={ytaOn} />

      {/* Song cockpit — pick a song ONCE → trend + audience + discovery together. */}
      <SongCockpit videos={retentionVideos} ytaConfigured={ytaOn} />

      {/* Song lifecycle report — the consolidated per-song write-up: weekly
          lifecycle, traffic-source (impression proxy) trend, loyalty split, and a
          plain-language decline diagnosis (reach cool-down vs engagement problem). */}
      <SongLifecycleReportPanel videos={retentionVideos} ytaConfigured={ytaOn} />

      {/* Retention intelligence — per-video hook verdict vs the best-retention
          template (the first-15s lever). Unique — not summarized by the cockpit. */}
      <RetentionInsightPanel
        videos={retentionVideos}
        benchmark={benchmarkRow ? { id: benchmarkRow.id, title: benchmarkRow.title } : undefined}
        ytaConfigured={ytaOn}
      />

      {/* Search scorecard — manual, human-observed positions for a song's tracked
          query set, scored by opportunity (biggest wins first). */}
      <SearchScorecardPanel />

      {/* Per-song deep dive — the FULL trend / geography / search-terms panels the
          cockpit summarizes, collapsed by default to remove the duplication. */}
      <PerSongDeepDive videos={retentionVideos} ytaConfigured={ytaOn} />

      {/* Viewer conversion funnel — DISCOVERED → WATCHED → 2ND SONG → RETURNED
          → SUBSCRIBED, modelled at cohort level (which stage is leaking). */}
      {/* Heavy (~6 Analytics reports on mount) — defer until scrolled into view
          so it doesn't fire on every dashboard open. */}
      <LazyMount>
        <FunnelInsightPanel ytaConfigured={ytaOn} />
      </LazyMount>

      {/* Interactive videos panel — pagination, sort, filter, CSV export,
          and a live date-range selector (re-queries owner Analytics). */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Thumbnails are mirrored from YouTube. Changed one there (e.g. to Tamil)? Re-pull it →
        </p>
        <RefreshThumbnailsButton />
      </div>
      <YouTubeVideosPanel initialRows={videoRows} ytaConfigured={ytaOn} initialDays={ANALYTICS_DAYS} />

    </div>
  );
}

const ANOMALY_STYLE: Record<Digest['anomaly']['status'], string> = {
  normal: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  surging: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  cooling: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  stalled: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  insufficient: 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300',
};

function DeltaMetric({ label, m, unit = '' }: { label: string; m: Digest['weekOverWeek']['views']; unit?: string }) {
  const up = m.deltaPct != null && m.deltaPct >= 0;
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label} · this week</p>
      <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {numberFmt.format(m.current)}{unit}
      </p>
      {m.deltaPct != null ? (
        <p className={`text-xs font-medium ${up ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {up ? '▲' : '▼'} {Math.abs(m.deltaPct)}% vs last week
        </p>
      ) : (
        <p className="text-xs text-gray-400">no prior week</p>
      )}
    </div>
  );
}

function DigestCard({ digest }: { digest: Digest }) {
  return (
    <section aria-labelledby="digest-heading" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="digest-heading" className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">This week</h2>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ANOMALY_STYLE[digest.anomaly.status]}`}>
          {digest.anomaly.status}
        </span>
      </div>
      <p className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">{digest.headline}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <DeltaMetric label="Views" m={digest.weekOverWeek.views} />
        <DeltaMetric label="Subscribers" m={digest.weekOverWeek.subscribersGained} />
        <DeltaMetric label="Watch time" m={digest.weekOverWeek.watchTimeMinutes} unit=" min" />
      </div>
      {(digest.anomaly.status === 'stalled' || digest.anomaly.status === 'cooling') && (
        <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">{digest.anomaly.message}</p>
      )}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Generic engagement card — handles all four states the dimension-aware
 * GA4 helper can return: hard error (red), dimension-not-registered
 * (amber + how-to), total > 0 with breakdown (bar list), zero events.
 */
function EngagementCard({
  title,
  footnote,
  res,
  emptyMessage,
  dimensionRegisterHints,
}: {
  title: string;
  footnote: string;
  res: Result<EngagementData> | null;
  emptyMessage: string;
  dimensionRegisterHints: { name: string; param: string };
}) {
  const data = res?.ok ? res.data : null;
  const error = res && !res.ok ? res.error : null;
  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.eventCount));

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</p>
          <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {numberFmt.format(total)}
            <span className="ml-1 text-sm font-normal text-gray-500 dark:text-gray-400">events</span>
          </p>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{footnote}</p>
      </div>
      {error ? (
        <pre className="overflow-x-auto rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 p-3 text-xs text-red-900 dark:text-red-200">
          {error}
        </pre>
      ) : data?.note === 'dimension-not-registered' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          <p className="mb-2">
            <strong>Custom dimension not registered yet.</strong> Total above is correct; the breakdown will appear once you register the dimension.
          </p>
          <p className="mb-1 text-xs">
            GA4: <strong>Admin → Custom definitions → Create custom dimension</strong>
          </p>
          <ul className="ml-4 list-disc text-xs">
            <li>Dimension name: <code>{dimensionRegisterHints.name}</code></li>
            <li>Scope: <code>Event</code></li>
            <li>Event parameter: <code>{dimensionRegisterHints.param}</code></li>
          </ul>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50 text-sm text-gray-500 dark:text-gray-400">{emptyMessage}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const pct = Math.round((row.eventCount / max) * 100);
            return (
              <li key={row.label} className="text-sm">
                <div className="mb-1 flex justify-between gap-3">
                  <span className="truncate font-medium text-gray-800 dark:text-gray-200" title={row.label}>{row.label}</span>
                  <span className="tabular-nums text-gray-600 dark:text-gray-400">{numberFmt.format(row.eventCount)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TrafficRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
      <span className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}
