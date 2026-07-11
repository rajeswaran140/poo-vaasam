'use client';

/**
 * Song Cockpit — the "manage one song at a glance" surface for /admin/youtube.
 *
 * Pick ONE song → it fetches its daily trend, audience geography, and search
 * discovery in parallel and shows them together, so you don't re-select the
 * same song in three separate panels. Each section is independently resilient:
 * if one endpoint fails or has no data yet, the others still render.
 *
 * This is the glance view; the standalone panels below remain for deep-dives
 * (full daily bars, full country list, retention curve).
 */

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { videoKind } from '@/lib/youtube-dashboard';
import type { VideoDailySummary } from '@/lib/youtube-dashboard';

type Fetched<T> = { ok: true; data: T } | { ok: false; error: string };

interface DailyResp {
  hasData: boolean;
  summary: VideoDailySummary;
}
interface GeoRow {
  country: string;
  countryName: string;
  flag: string;
  views: number;
  sharePct: number;
}
interface GeoResp {
  hasData: boolean;
  rows: GeoRow[];
  countryCount: number;
}
interface SearchResp {
  hasData: boolean;
  totalSearchViews: number;
  terms: Array<{ term: string; views: number }>;
}

const numberFmt = new Intl.NumberFormat('en-US');

async function fetchJson<T extends { success: boolean }>(url: string): Promise<Fetched<T>> {
  try {
    const res = await adminFetch(url);
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok || !json.success) return { ok: false, error: json.error || `Request failed (${res.status})` };
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function TrendBadge({ last7, prev7 }: { last7: number; prev7: number }) {
  if (prev7 === 0) return <span className="text-gray-400">—</span>;
  const pct = Math.round(((last7 - prev7) / prev7) * 100);
  const up = pct >= 0;
  return (
    <span className={up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  );
}

function SectionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h3>
      {children}
    </div>
  );
}

export function SongCockpit({
  videos,
  ytaConfigured,
}: {
  videos: Array<{ id: string; title: string; durationSeconds: number }>;
  ytaConfigured: boolean;
}) {
  const [videoId, setVideoId] = useState(videos[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [daily, setDaily] = useState<Fetched<DailyResp & { success: boolean }> | null>(null);
  const [geo, setGeo] = useState<Fetched<GeoResp & { success: boolean }> | null>(null);
  const [search, setSearch] = useState<Fetched<SearchResp & { success: boolean }> | null>(null);

  function pick(id: string) {
    setVideoId(id);
    setDaily(null);
    setGeo(null);
    setSearch(null);
  }

  async function load() {
    if (!videoId) return;
    setLoading(true);
    setDaily(null);
    setGeo(null);
    setSearch(null);
    const q = new URLSearchParams({ videoId }).toString();
    const [d, g, s] = await Promise.all([
      fetchJson<DailyResp & { success: boolean }>(`/api/admin/youtube/video-daily?${q}`),
      fetchJson<GeoResp & { success: boolean }>(`/api/admin/youtube/geography?${q}`),
      fetchJson<SearchResp & { success: boolean }>(`/api/admin/youtube/search-terms?${q}`),
    ]);
    setDaily(d);
    setGeo(g);
    setSearch(s);
    setLoading(false);
  }

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="cockpit-heading" className="space-y-2">
        <h2 id="cockpit-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Song cockpit
        </h2>
        <p className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Connect YouTube Analytics (OAuth) to manage a song&apos;s trend, audience and discovery in one place.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="cockpit-heading" className="space-y-3">
      <div>
        <h2 id="cockpit-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Song cockpit
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Pick a song once → its daily trend, audience geography and search discovery, together.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span className="sr-only">Choose a video</span>
          <select
            value={videoId}
            onChange={(e) => pick(e.target.value)}
            className="max-w-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100"
          >
            {videos.map((vid) => (
              <option key={vid.id} value={vid.id}>
                {vid.title}
                {videoKind(vid.durationSeconds) === 'short' ? ' · Short' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={load}
          disabled={loading || !videoId}
          className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'View song'}
        </button>
      </div>

      {(daily || geo || search) && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Trend */}
          <SectionShell title="Trend (28d)">
            {!daily ? null : !daily.ok ? (
              <p className="text-xs text-red-600 dark:text-red-400" role="alert">{daily.error}</p>
            ) : !daily.data.hasData ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">No daily data yet.</p>
            ) : (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Views</span><span className="tabular-nums font-semibold">{numberFmt.format(daily.data.summary.totalViews)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Subscribers</span><span className="tabular-nums font-semibold">{daily.data.summary.totalSubscribers >= 0 ? '+' : ''}{numberFmt.format(daily.data.summary.totalSubscribers)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">7d vs prior</span><span className="tabular-nums font-semibold"><TrendBadge last7={daily.data.summary.last7Views} prev7={daily.data.summary.prev7Views} /></span></div>
                {daily.data.summary.bestDay && (
                  <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Best day</span><span className="tabular-nums">{daily.data.summary.bestDay.date}</span></div>
                )}
              </div>
            )}
          </SectionShell>

          {/* Audience */}
          <SectionShell title="Top countries">
            {!geo ? null : !geo.ok ? (
              <p className="text-xs text-red-600 dark:text-red-400" role="alert">{geo.error}</p>
            ) : !geo.data.hasData ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">No geography data yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {geo.data.rows.slice(0, 5).map((c) => (
                  <li key={c.country} className="flex justify-between">
                    <span><span aria-hidden className="mr-1">{c.flag}</span>{c.countryName}</span>
                    <span className="tabular-nums text-gray-600 dark:text-gray-400">{Math.round(c.sharePct)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionShell>

          {/* Discovery */}
          <SectionShell title="Top search terms">
            {!search ? null : !search.ok ? (
              <p className="text-xs text-red-600 dark:text-red-400" role="alert">{search.error}</p>
            ) : !search.data.hasData ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">No search-driven views yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {search.data.terms.slice(0, 5).map((t) => (
                  <li key={t.term} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{t.term}</span>
                    <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-400">{numberFmt.format(t.views)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionShell>
        </div>
      )}
    </section>
  );
}
