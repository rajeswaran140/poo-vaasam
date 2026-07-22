'use client';

/**
 * /admin/analytics — website traffic & user activity.
 *
 * Reads GET /api/admin/analytics (GA4 Data API + first-party DynamoDB view
 * counts). Pure-presentation: summary cards, a traffic trend, top pages,
 * sources, geography, devices, and the tracked activities (plays / subscribe
 * clicks / YouTube opens). Degrades gracefully — a GA4 config banner + the
 * first-party section still render when GA4 isn't set up.
 */

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { MonetizationPanel } from '@/components/admin/MonetizationPanel';

type Section<T> = { data: T } | { error: string };
interface Snapshot { totalUsers: number; sessions: number; pageViews: number; daysBack: number }
interface DayPoint { date: string; users: number; sessions: number; pageViews: number }
interface PageRow { path: string; title: string; pageViews: number }
interface DimRow { key: string; value: number }
interface EngRow { label: string; eventCount: number }
interface Engagement { rows: EngRow[]; total: number; note?: string }
interface ViewedContent { id: string; title: string; type: string; path: string; viewCount: number }
interface ContentViews { totalViews: number; itemCount: number; top: ViewedContent[] }
interface EventSummaryUI {
  total: number;
  totals: { type: string; count: number }[];
  byType: Record<string, { target: string; count: number }[]>;
}

interface Payload {
  ga4Configured: boolean;
  days: number;
  contentViews: ContentViews | null;
  events: EventSummaryUI | null;
  /** Content id → title, for labelling the per-song event breakdowns. */
  songTitles?: Record<string, string>;
  ga4: null | {
    snapshot: Section<Snapshot>;
    timeseries: Section<{ points: DayPoint[]; daysBack: number }>;
    topPages: Section<PageRow[]>;
    sources: Section<DimRow[]>;
    geo: Section<DimRow[]>;
    devices: Section<DimRow[]>;
    audioPlays: Section<Engagement>;
    subscribeClicks: Section<Engagement>;
    youtubeOpens: Section<Engagement>;
  };
}

const pick = <T,>(s: Section<T> | undefined): { data?: T; error?: string } =>
  !s ? {} : 'data' in s ? { data: s.data } : { error: s.error };
const nf = (n: number) => n.toLocaleString();

/** Turn a bare status into something an admin can act on, not "HTTP 403". */
function httpErrorMessage(status: number): string {
  if (status === 401) return 'Your session expired — sign in again.';
  if (status === 403) return 'Your account isn’t an admin on this environment.';
  if (status >= 500) return 'The analytics service failed. Try again shortly.';
  return `Couldn’t load analytics (HTTP ${status}).`;
}

const EVENT_LABEL: Record<string, string> = {
  play: 'Plays', share: 'Shares', youtube: 'YouTube opens', subscribe: 'Subscribe clicks', install: 'PWA installs',
  inbound: 'Inbound visits (by source)',
};
const EVENT_UNIT: Record<string, string> = {
  play: 'plays', share: 'shares', youtube: 'opens', subscribe: 'clicks', install: 'installs',
  inbound: 'visits',
};

/**
 * Server-derived per-song breakdowns. These are a second view of an action
 * already counted (a share writes both `share` and `share_song`), so they're
 * rendered as their own attribution section rather than mixed into the action
 * cards — and deliberately excluded from the headline total by the API.
 */
const SONG_BREAKDOWNS: { type: string; title: string; unit: string; empty: string }[] = [
  { type: 'share_song', title: 'Most-forwarded songs', unit: 'shares', empty: 'No song-attributed shares yet.' },
  { type: 'inbound_song', title: 'Songs driving inbound visits', unit: 'visits', empty: 'No song-attributed arrivals yet.' },
];

export default function AnalyticsPage() {
  const [days, setDays] = useState(28);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Toggling the range mid-flight used to be a race: both requests resolved and
  // whichever landed LAST won, so a slow 7d response could overwrite 90d data
  // and render it under the 7d label. Aborting the previous request also keeps
  // overlapping loads from doubling up on GA4's 10-concurrent-request quota.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setErr(null);

    (async () => {
      try {
        const res = await adminFetch(`/api/admin/analytics?days=${days}`, { signal: controller.signal });
        if (!res.ok) throw new Error(httpErrorMessage(res.status));
        const json = await res.json();
        if (!controller.signal.aborted) setPayload(json);
      } catch (e) {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        setErr(e instanceof Error ? e.message : 'Failed to load analytics');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [days]);

  const ga4 = payload?.ga4;
  const snap = pick(ga4?.snapshot).data;
  const series = pick(ga4?.timeseries).data?.points ?? [];
  const maxPv = Math.max(1, ...series.map((p) => p.pageViews));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">Last {days} days · GA4 + on-site view counts</p>
        <div className="flex gap-1">
          {[7, 28, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              aria-pressed={d === days}
              aria-label={`Show last ${d} days`}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                d === days ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Monetization & YPP gates — self-contained (own adminFetch); sits above
          the GA4 sections so the partner-program tracker leads the dashboard. */}
      <MonetizationPanel />

      {loading && <p className="text-gray-500">Loading…</p>}
      {err && <Banner tone="error">{err}</Banner>}
      {payload && !payload.ga4Configured && (
        <Banner tone="warn">GA4 isn’t configured (GA4_PROPERTY_ID / GA4_SERVICE_ACCOUNT_KEY) — showing on-site view counts only.</Banner>
      )}

      {payload && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Users" value={snap ? nf(snap.totalUsers) : '—'} />
            <Stat label="Sessions" value={snap ? nf(snap.sessions) : '—'} />
            <Stat label="Page views" value={snap ? nf(snap.pageViews) : '—'} />
            <Stat label="On-site content views" value={payload.contentViews ? nf(payload.contentViews.totalViews) : '—'} sub="first-party (all time)" />
          </div>

          {/* Traffic trend */}
          {series.length > 0 && (
            <Card title="Traffic trend (page views / day)">
              <div
                className="flex h-28 items-end gap-[2px]"
                role="img"
                aria-label={
                  `Page views per day over the last ${days} days: ` +
                  `ranging from ${Math.min(...series.map((p) => p.pageViews)).toLocaleString()} to ${maxPv.toLocaleString()}, ` +
                  `latest day ${(series[series.length - 1]?.pageViews ?? 0).toLocaleString()}.`
                }
              >
                {series.map((p) => (
                  <div
                    key={p.date}
                    title={`${p.date}: ${p.pageViews} views · ${p.users} users`}
                    aria-hidden="true"
                    className="flex-1 rounded-t bg-orange-500/80 hover:bg-orange-600"
                    style={{ height: `${Math.max(2, (p.pageViews / maxPv) * 100)}%` }}
                  />
                ))}
              </div>
            </Card>
          )}

          {/* Pages + sources */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Top pages" error={pick(ga4?.topPages).error}>
              <Table rows={(pick(ga4?.topPages).data ?? []).map((r) => ({ k: r.path, sub: r.title, v: r.pageViews }))} unit="views" />
            </Card>
            <Card title="Traffic sources" error={pick(ga4?.sources).error}>
              <Table rows={(pick(ga4?.sources).data ?? []).map((r) => ({ k: r.key, v: r.value }))} unit="sessions" />
            </Card>
          </div>

          {/* Geo + devices */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Top countries" error={pick(ga4?.geo).error}>
              <Table rows={(pick(ga4?.geo).data ?? []).map((r) => ({ k: r.key, v: r.value }))} unit="users" />
            </Card>
            <Card title="Devices" error={pick(ga4?.devices).error}>
              <Table rows={(pick(ga4?.devices).data ?? []).map((r) => ({ k: r.key, v: r.value }))} unit="sessions" />
            </Card>
          </div>

          {/* User activity */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Top played songs" error={pick(ga4?.audioPlays).error}>
              <Table rows={(pick(ga4?.audioPlays).data?.rows ?? []).map((r) => ({ k: r.label, v: r.eventCount }))} unit="plays" />
            </Card>
            <Card title={`Subscribe clicks (${pick(ga4?.subscribeClicks).data?.total ?? 0})`} error={pick(ga4?.subscribeClicks).error}>
              <Table rows={(pick(ga4?.subscribeClicks).data?.rows ?? []).map((r) => ({ k: r.label, v: r.eventCount }))} unit="clicks" empty="No per-source breakdown yet." />
            </Card>
            <Card title="YouTube opens" error={pick(ga4?.youtubeOpens).error}>
              <Table rows={(pick(ga4?.youtubeOpens).data?.rows ?? []).map((r) => ({ k: r.label, v: r.eventCount }))} unit="opens" />
            </Card>
          </div>

          {/* First-party events — owned in DynamoDB, so they survive ad-blockers
              that drop GA4. Shares (esp. WhatsApp) + installs aren't in GA4. */}
          {payload.events && payload.events.total > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                First-party events
                <span className="ml-2 font-normal text-xs text-gray-400">ad-block-resilient · {nf(payload.events.total)} in last {days}d</span>
              </h2>
              <div className="grid gap-4 lg:grid-cols-3">
                {payload.events.totals.map(({ type, count }) => (
                  <Card key={type} title={`${EVENT_LABEL[type] ?? type} (${nf(count)})`}>
                    <Table
                      rows={(payload.events?.byType[type] ?? []).map((t) => ({ k: t.target, v: t.count }))}
                      unit={EVENT_UNIT[type] ?? ''}
                      empty="No breakdown yet."
                    />
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Per-song attribution — derived server-side from the songId on share
              and inbound beacons. Kept out of the action total above (a share
              writes both counters) but shown here, because "which song do people
              actually forward?" is the question the beacon exists to answer. */}
          {payload.events && SONG_BREAKDOWNS.some((b) => (payload.events?.byType[b.type] ?? []).length > 0) && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Per-song attribution
                <span className="ml-2 font-normal text-xs text-gray-400">
                  not counted again in the total above · last {days}d
                </span>
              </h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {SONG_BREAKDOWNS.map((b) => (
                  <Card key={b.type} title={b.title}>
                    <Table
                      rows={(payload.events?.byType[b.type] ?? []).map((t) => ({
                        k: payload.songTitles?.[t.target] || t.target,
                        sub: t.target,
                        v: t.count,
                      }))}
                      unit={b.unit}
                      empty={b.empty}
                    />
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* First-party top-viewed content */}
          {payload.contentViews && payload.contentViews.top.length > 0 && (
            <Card title="Most-viewed content (on-site, all time)">
              <Table rows={payload.contentViews.top.map((c) => ({ k: c.title, sub: c.path, v: c.viewCount }))} unit="views" />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function Card({ title, error, children }: { title: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      {error ? <p className="text-xs text-red-500">{error}</p> : children}
    </div>
  );
}

function Table({ rows, unit, empty }: { rows: { k: string; sub?: string; v: number }[]; unit: string; empty?: string }) {
  if (!rows.length) return <p className="text-xs text-gray-400">{empty ?? 'No data yet.'}</p>;
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={`${r.k}-${i}`}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-tamil text-gray-700 dark:text-gray-200" title={r.sub || r.k}>{r.k || '(not set)'}</span>
            <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">{r.v.toLocaleString()}{unit ? ` ${unit}` : ''}</span>
          </div>
          <div className="mt-1 h-1 rounded bg-gray-100 dark:bg-gray-700">
            <div className="h-1 rounded bg-orange-500/70" style={{ width: `${(r.v / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Banner({ tone, children }: { tone: 'warn' | 'error'; children: React.ReactNode }) {
  const cls = tone === 'error'
    ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
    : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300';
  return <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}
