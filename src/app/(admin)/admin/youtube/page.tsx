/**
 * /admin/youtube — Phase 1 YouTube analytics dashboard.
 *
 * Shows a channel snapshot (subs, total views, video count) and the latest
 * videos with view/like/comment counts and duration. Cross-references each
 * YouTube video against the site's content table to flag videos that have
 * no matching /content/[id] page — those are the obvious next things to
 * publish on the site.
 *
 * Server component. Reads happen here; the page itself is admin-gated via
 * the (admin) layout, so no client-side auth check is needed.
 */

import { SITE, isYouTubeVideosConfigured } from '@/config/site';
import {
  fetchChannelStats,
  fetchChannelVideoStats,
  isYouTubeApiConfigured,
  formatDuration,
  type VideoStats,
} from '@/lib/youtube-api';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentStatus } from '@/types/content';
import { videoMatchesContent } from '@/lib/youtube-match';
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
  isYouTubeAnalyticsConfigured,
} from '@/lib/youtube-analytics';
import { generateYouTubeRecommendations } from '@/services/ai/youtube-recommendations';

export const revalidate = 1800; // 30 min — pairs with the 1-hr upstream fetch cache

const numberFmt = new Intl.NumberFormat('en-US');

/**
 * Cross-reference YouTube uploads against published content of any type. Uses
 * the fuzzy matcher in lib/youtube-match so YouTube's descriptive titles
 * ("அந்தி மேகமே. . . எங்கே சாய்கின்றாய். . .") still match the short DB
 * title ("அந்தி மேகமே"), and so a populated videoUrl always wins outright.
 */
async function getMatchedVideoIds(videos: VideoStats[]): Promise<Set<string>> {
  if (videos.length === 0) return new Set();
  const matched = new Set<string>();
  try {
    const repo = new ContentRepository();
    // Page through ALL published content — any record may carry a YouTube
    // link or a title that matches an upload, not just SONGS/POEMS/LYRICS.
    let cursor: Record<string, unknown> | undefined;
    type Entity = Awaited<ReturnType<typeof repo.findAll>>['items'][number];
    const items: Entity[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await repo.findAll({
        limit: 100,
        status: ContentStatus.PUBLISHED,
        lastEvaluatedKey: cursor,
      });
      items.push(...res.items);
      cursor = res.lastEvaluatedKey;
      if (!cursor) break;
    }

    for (const item of items) {
      const c = item.toObject();
      for (const v of videos) {
        if (matched.has(v.id)) continue;
        if (videoMatchesContent(v, c)) matched.add(v.id);
      }
    }
  } catch (err) {
    console.error('[admin/youtube] failed to load content for matching:', err);
  }
  return matched;
}

export default async function YouTubeAdminPage() {
  if (!isYouTubeVideosConfigured()) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        YouTube channel not configured. Set <code>SITE.youtube.channelId</code> in <code>src/config/site.ts</code>.
      </div>
    );
  }

  if (!isYouTubeApiConfigured()) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">YouTube Analytics</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
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
  const [channel, videos, ga4ClicksRes, ga4TrafficRes, ga4AudioRes, ga4YouTubeRes, ytaChannelRes, ytaVideosRes] = await Promise.all([
    fetchChannelStats(SITE.youtube.channelId),
    fetchChannelVideoStats(SITE.youtube.channelId, 50),
    ga4On ? fetchSubscribeClicksBySource(28) : Promise.resolve(null),
    ga4On ? fetchTrafficSnapshot(28) : Promise.resolve(null),
    ga4On ? fetchAudioPlays(28) : Promise.resolve(null),
    ga4On ? fetchYouTubeOpens(28) : Promise.resolve(null),
    ytaOn ? fetchChannelAnalyticsSnapshot(28) : Promise.resolve(null),
    ytaOn ? fetchVideoAnalytics(28) : Promise.resolve(null),
  ]);

  if (!channel) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
        Couldn&apos;t reach the YouTube Data API. Check the key, the channel ID, and the project&apos;s daily quota.
      </div>
    );
  }

  const matched = await getMatchedVideoIds(videos);
  const unmatched = videos.filter((v) => !matched.has(v.id));

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
  const ytaError = ytaChannelRes && !ytaChannelRes.ok ? ytaChannelRes.error : null;
  const titlesByVideoId = Object.fromEntries(videos.map((v) => [v.id, v.title]));
  const recommendations =
    ytaChannel && ytaVideos.length > 0
      ? await generateYouTubeRecommendations({ channel: ytaChannel, videos: ytaVideos, titles: titlesByVideoId })
      : null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">YouTube Analytics</h1>
          <p className="text-sm text-gray-500">
            {channel.title} ·{' '}
            <a
              href={SITE.youtube.channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-600 hover:underline"
            >
              Open channel ↗
            </a>
          </p>
        </div>
        <p className="text-xs text-gray-500">Cached for 30 min · YouTube API for 1 hour</p>
      </header>

      {/* Snapshot cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Subscribers" value={numberFmt.format(channel.subscriberCount)} />
        <StatCard label="Total views" value={numberFmt.format(channel.viewCount)} />
        <StatCard label="Videos published" value={numberFmt.format(channel.videoCount)} />
      </section>

      {/* GA4 — site signals */}
      {ga4On ? (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Subscribe CTA performance — the headline Phase 2 card. */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Subscribe CTA · last 28 days
                </p>
                <p className="text-2xl font-bold tabular-nums text-gray-900">
                  {numberFmt.format(totalSubscribeClicks)} <span className="text-sm font-normal text-gray-500">clicks</span>
                </p>
              </div>
              <p className="text-xs text-gray-500">Source: GA4 subscribe_click event</p>
            </div>
            {clicksError ? (
              <pre className="overflow-x-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                {clicksError}
              </pre>
            ) : clicksData?.note === 'dimension-not-registered' ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
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
              <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
                No subscribe_click events recorded yet. The event fires on every Subscribe CTA — once visitors click, breakdowns will appear here.
              </p>
            ) : (
              <ul className="space-y-2">
                {clickRows.map((row) => {
                  const pct = Math.round((row.eventCount / maxSubscribeClicks) * 100);
                  return (
                    <li key={row.source} className="text-sm">
                      <div className="mb-1 flex justify-between">
                        <span className="font-medium text-gray-800">{row.source}</span>
                        <span className="tabular-nums text-gray-600">{numberFmt.format(row.eventCount)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Traffic snapshot */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
              Site traffic · last {traffic?.daysBack ?? 28} days
            </p>
            {trafficError ? (
              <pre className="overflow-x-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                {trafficError}
              </pre>
            ) : traffic ? (
              <div className="space-y-3">
                <TrafficRow label="Users" value={numberFmt.format(traffic.totalUsers)} />
                <TrafficRow label="Sessions" value={numberFmt.format(traffic.sessions)} />
                <TrafficRow label="Pageviews" value={numberFmt.format(traffic.pageViews)} />
              </div>
            ) : (
              <p className="text-sm text-gray-500">No data yet.</p>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
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
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Subscribers · last 28 days
            </p>
            <p className="text-2xl font-bold tabular-nums text-gray-900">
              {ytaChannel ? `+${numberFmt.format(ytaChannel.subscribersGained)}` : '—'}
              {ytaChannel && ytaChannel.subscribersLost > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  −{numberFmt.format(ytaChannel.subscribersLost)} lost
                </span>
              )}
            </p>
            {ytaChannel && (
              <p className="mt-1 text-xs text-gray-500">
                {numberFmt.format(ytaChannel.views)} views ·{' '}
                {Math.round(ytaChannel.estimatedMinutesWatched).toLocaleString()} min watched ·{' '}
                avg {Math.round(ytaChannel.averageViewDuration)}s
              </p>
            )}
            {ytaError && (
              <pre className="mt-3 overflow-x-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                {ytaError}
              </pre>
            )}
          </div>

          {/* Per-video subscriber gains */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
              Subs gained per video · last 28 days
            </p>
            {ytaVideos.length === 0 ? (
              <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
                No per-video data yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {ytaVideos.slice(0, 5).map((v) => {
                  const title = titlesByVideoId[v.videoId] ?? v.videoId;
                  return (
                    <li key={v.videoId} className="text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-medium text-gray-800" title={title}>{title}</span>
                        <span className="tabular-nums text-gray-600">+{v.subscribersGained}</span>
                      </div>
                      <p className="text-[10px] text-gray-500">
                        {numberFmt.format(v.views)} views · avg {Math.round(v.averageViewDuration)}s
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* AI recommendations */}
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-5 shadow-sm lg:col-span-1">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-orange-700">
              AI recommendations
            </p>
            {!recommendations ? (
              <p className="text-sm text-orange-900">Generated when analytics return data.</p>
            ) : recommendations.ok ? (
              <ul className="list-disc space-y-2 pl-4 text-sm text-orange-900">
                {recommendations.data.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            ) : (
              <pre className="overflow-x-auto rounded border border-red-200 bg-white p-2 text-xs text-red-900">
                {recommendations.error}
              </pre>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
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

      {/* "Not on the site" gap list — actionable publishing hints */}
      {unmatched.length > 0 && (
        <section className="rounded-xl border border-orange-200 bg-orange-50 p-5">
          <h2 className="mb-2 text-sm font-semibold text-orange-900">
            {unmatched.length} video{unmatched.length === 1 ? '' : 's'} not yet on the site
          </h2>
          <p className="mb-3 text-xs text-orange-800">
            These YouTube uploads have no matching <code>/content/[id]</code> entry. Publishing them on the site funnels organic search back to the channel.
          </p>
          <ul className="space-y-1 text-sm">
            {unmatched.map((v) => (
              <li key={v.id} className="truncate">
                <a
                  href={`https://www.youtube.com/watch?v=${v.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-700 hover:underline"
                >
                  {v.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Videos table */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Latest videos</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Video</th>
                <th className="px-4 py-3 text-right">Views</th>
                <th className="px-4 py-3 text-right">Likes</th>
                <th className="px-4 py-3 text-right">Comments</th>
                <th className="px-4 py-3 text-right">Duration</th>
                <th className="px-4 py-3 text-right">On site</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {videos.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No videos returned.</td></tr>
              ) : (
                videos.map((v) => {
                  const isMatched = matched.has(v.id);
                  return (
                    <tr key={v.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <a
                          href={`https://www.youtube.com/watch?v=${v.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate font-medium text-gray-900 hover:text-orange-600"
                          title={v.title}
                        >
                          {v.title}
                        </a>
                        <span className="text-xs text-gray-500">
                          {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{numberFmt.format(v.viewCount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{numberFmt.format(v.likeCount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{numberFmt.format(v.commentCount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">{formatDuration(v.durationSeconds)}</td>
                      <td className="px-4 py-3 text-right">
                        {isMatched ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">✓</span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">missing</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900 tabular-nums">{value}</p>
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
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</p>
          <p className="text-2xl font-bold tabular-nums text-gray-900">
            {numberFmt.format(total)}
            <span className="ml-1 text-sm font-normal text-gray-500">events</span>
          </p>
        </div>
        <p className="text-xs text-gray-500">{footnote}</p>
      </div>
      {error ? (
        <pre className="overflow-x-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          {error}
        </pre>
      ) : data?.note === 'dimension-not-registered' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
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
        <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">{emptyMessage}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const pct = Math.round((row.eventCount / max) * 100);
            return (
              <li key={row.label} className="text-sm">
                <div className="mb-1 flex justify-between gap-3">
                  <span className="truncate font-medium text-gray-800" title={row.label}>{row.label}</span>
                  <span className="tabular-nums text-gray-600">{numberFmt.format(row.eventCount)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
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
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-xl font-bold tabular-nums text-gray-900">{value}</span>
    </div>
  );
}
