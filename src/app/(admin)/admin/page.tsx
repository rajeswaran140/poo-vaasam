/**
 * /admin — main dashboard.
 *
 * Signals-first: a KPI strip up top (subs · users · sessions · audio plays ·
 * subscribe clicks) deep-links into /admin/youtube and /admin/songs for the
 * details. Content overview only surfaces the content types that are
 * actually live per CONTENT_SECTIONS.live (Songs + Poems today). Recent
 * Content sorted by createdAt desc with edit/view per row.
 */

import Link from 'next/link';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';
import { CONTENT_SECTIONS, SITE, isYouTubeVideosConfigured } from '@/config/site';
import {
  fetchTrafficSnapshot,
  fetchAudioPlaysBySongId,
  fetchSubscribeClicksBySource,
  isGA4Configured,
} from '@/lib/ga4-api';
import { fetchChannelStats, isYouTubeApiConfigured } from '@/lib/youtube-api';

// Fetch at request time. Amplify doesn't run ISR, so a `revalidate` page froze
// at build — new content never showed in "Recent Content" and the KPI strip was
// stuck at build-time GA4 numbers. Runtime DynamoDB + GA4 reads work via the
// inlined creds (next.config.ts).
export const dynamic = 'force-dynamic';

const numberFmt = new Intl.NumberFormat('en-US');

// Content types we'd ever count, gated to the registry's `live` flag.
const LIVE_TYPES = CONTENT_SECTIONS.filter((s) => s.live).map((s) => s.type as ContentType);

interface DashboardStats {
  perType: Record<string, number>;
  published: number;
  draft: number;
}

async function getStats(): Promise<DashboardStats | null> {
  try {
    const repo = new ContentRepository();
    const [typeCounts, published, draft] = await Promise.all([
      Promise.all(LIVE_TYPES.map((t) => repo.countByType(t))),
      repo.countByStatus(ContentStatus.PUBLISHED),
      repo.countByStatus(ContentStatus.DRAFT),
    ]);
    const perType: Record<string, number> = {};
    LIVE_TYPES.forEach((t, i) => { perType[t] = typeCounts[i]; });
    return { perType, published, draft };
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return null;
  }
}

interface ContentRow {
  id: string;
  title: string;
  type: string;
  author: string;
  status: string;
  viewCount?: number;
  createdAt?: string | Date;
}

async function getRecentContent(): Promise<ContentRow[]> {
  try {
    const repo = new ContentRepository();
    // GSI sort key embeds createdAt — repo's default is newest-first.
    const result = await repo.findAll({ limit: 8 });
    return result.items.map((item) => item.toObject() as ContentRow);
  } catch (error) {
    console.error('Failed to fetch content:', error);
    return [];
  }
}

export default async function AdminDashboard() {
  const ga4On = isGA4Configured();
  const ytOn = isYouTubeApiConfigured() && isYouTubeVideosConfigured();

  const [stats, recentContent, channel, traffic, audioPlays, subClicks] = await Promise.all([
    getStats(),
    getRecentContent(),
    ytOn ? fetchChannelStats(SITE.youtube.channelId) : Promise.resolve(null),
    ga4On ? fetchTrafficSnapshot(7) : Promise.resolve(null),
    ga4On ? fetchAudioPlaysBySongId(28) : Promise.resolve(null),
    ga4On ? fetchSubscribeClicksBySource(28) : Promise.resolve(null),
  ]);

  const totalSongs = stats?.perType['SONGS'] ?? 0;
  const totalPoems = stats?.perType['POEMS'] ?? 0;
  const totalLive = LIVE_TYPES.reduce((sum, t) => sum + (stats?.perType[t] ?? 0), 0);

  const trafficUsers = traffic?.ok ? traffic.data.totalUsers : null;
  const trafficSessions = traffic?.ok ? traffic.data.sessions : null;
  const audioTotal = audioPlays?.ok ? audioPlays.data.total : null;
  const subTotal = subClicks?.ok ? subClicks.data.total : null;

  return (
    <div className="space-y-8">
      {/* Welcome banner — compact, brand-aligned */}
      <div className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-700 p-6 text-white shadow-lg">
        <h1 className="font-kavivanar text-2xl font-bold">வணக்கம், இராஜேஸ்வரன்</h1>
        <p className="mt-1 text-sm text-orange-50/90">
          {totalLive} live content {totalLive === 1 ? 'item' : 'items'} ·{' '}
          {stats?.published ?? 0} published · {stats?.draft ?? 0} draft
        </p>
      </div>

      {/* KPI strip — signals first */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Signals · last {ga4On ? '7d / 28d' : '—'}
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Subscribers" value={channel ? numberFmt.format(channel.subscriberCount) : '—'} href="/admin/youtube" />
          <Kpi label="Users · 7d" value={trafficUsers != null ? numberFmt.format(trafficUsers) : '—'} sub={trafficSessions != null ? `${numberFmt.format(trafficSessions)} sessions` : undefined} href="/admin/youtube" />
          <Kpi label="Audio plays · 28d" value={audioTotal != null ? numberFmt.format(audioTotal) : '—'} href="/admin/songs" />
          <Kpi label="Subscribe clicks · 28d" value={subTotal != null ? numberFmt.format(subTotal) : '—'} href="/admin/youtube" />
        </div>
        {!ga4On && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            GA4 not configured — only YouTube subscriber count is live. Set <code>GA4_PROPERTY_ID</code> + <code>GA4_SERVICE_ACCOUNT_KEY</code> in Amplify env.
          </p>
        )}
      </section>

      {/* Content overview — only live types */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Content
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <ContentCard title="Songs" value={totalSongs} icon="🎵" href="/admin/songs" />
          <ContentCard title="Poems" value={totalPoems} icon="📝" href="/admin/content?type=POEMS" />
          <ContentCard title="Published" value={stats?.published ?? 0} icon="✅" tone="success" href="/admin/content?status=PUBLISHED" />
          <ContentCard title="Drafts" value={stats?.draft ?? 0} icon="📄" tone="amber" href="/admin/content?status=DRAFT" />
        </div>
      </section>

      {/* Recent Content */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Recent Content
          </h2>
          <Link href="/admin/content" className="text-sm font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300">
            View all →
          </Link>
        </div>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          {recentContent.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              <p>No content yet — start with <Link href="/admin/content/new" className="text-orange-600 hover:underline dark:text-orange-400">new content</Link>.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                  <tr>
                    <th className="px-6 py-3">Title</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3 text-right">Views</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {recentContent.slice(0, 8).map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-6 py-3">
                        <Link href={`/admin/content/${c.id}/edit`} className="font-tamil font-medium text-gray-900 hover:text-orange-600 dark:text-gray-100 dark:hover:text-orange-400">
                          {c.title}
                        </Link>
                      </td>
                      <td className="px-6 py-3">
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-500/20 dark:text-orange-300">
                          {c.type}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            c.status === 'PUBLISHED'
                              ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{c.viewCount ?? 0}</td>
                      <td className="px-6 py-3 text-right text-xs">
                        <div className="flex justify-end gap-2">
                          <Link href={`/admin/content/${c.id}/edit`} className="text-orange-600 hover:underline dark:text-orange-400">Edit</Link>
                          <Link href={`/content/${c.id}`} target="_blank" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">View</Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Quick Actions — aligned with what actually happens on this site */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ActionCard title="New song" description="Publish audio from S3 or via the upload form" icon="🎵" href="/admin/content/new" tone="orange" />
          <ActionCard title="Songs library" description="Themes, durations, play counts per song" icon="📚" href="/admin/songs" tone="indigo" />
          <ActionCard title="YouTube analytics" description="Subscribe-CTA, traffic, audio + outbound" icon="📊" href="/admin/youtube" tone="emerald" />
        </div>
      </section>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function Kpi({ label, value, sub, href }: { label: string; value: string; sub?: string; href: string }) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</p>}
    </Link>
  );
}

function ContentCard({ title, value, icon, href, tone }: { title: string; value: number; icon: string; href: string; tone?: 'success' | 'amber' }) {
  const toneIcon =
    tone === 'success' ? 'bg-green-100 dark:bg-green-500/20'
    : tone === 'amber' ? 'bg-amber-100 dark:bg-amber-500/20'
    : 'bg-orange-100 dark:bg-orange-500/20';
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
    >
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{numberFmt.format(value)}</p>
      </div>
      <div className={`flex h-12 w-12 items-center justify-center rounded-lg text-2xl ${toneIcon}`} aria-hidden>
        {icon}
      </div>
    </Link>
  );
}

function ActionCard({ title, description, icon, href, tone }: { title: string; description: string; icon: string; href: string; tone: 'orange' | 'indigo' | 'emerald' }) {
  const grad =
    tone === 'orange' ? 'from-orange-500 to-orange-700'
    : tone === 'indigo' ? 'from-indigo-500 to-indigo-700'
    : 'from-emerald-500 to-emerald-700';
  return (
    <Link
      href={href}
      className={`block rounded-xl bg-gradient-to-br ${grad} p-6 text-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg`}
    >
      <div className="mb-3 text-3xl">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-white/85">{description}</p>
    </Link>
  );
}
