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

import Link from 'next/link';
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

  const [channel, videos] = await Promise.all([
    fetchChannelStats(SITE.youtube.channelId),
    fetchChannelVideoStats(SITE.youtube.channelId, 50),
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

      <p className="text-xs text-gray-500">
        Want subscriber-gain per video and traffic sources?{' '}
        <Link href="/admin" className="text-orange-600 hover:underline">Phase 3</Link> adds the YouTube Analytics API (OAuth-gated).
      </p>
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
