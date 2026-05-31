'use client';

/**
 * Interactive songs table — filter row above + table below. Lives in
 * /admin/songs. Takes pre-fetched data as props (page does the DB +
 * GA4 reads server-side), then filters client-side so the URL doesn't
 * need to change as the admin types.
 *
 * Filters compose as AND: title substring (case-insensitive), status,
 * theme. "All" sentinel means "no filter on this axis." Empty filtered
 * result renders a friendly hint instead of a blank tbody.
 */

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { SONG_THEMES, SONG_THEME_LABELS, type SongTheme, themeForSongWithOverride } from '@/config/song-themes';
import { ThemeSelect } from '@/components/admin/ThemeSelect';
import { getYouTubeId } from '@/lib/utils/youtube';

const numberFmt = new Intl.NumberFormat('en-US');

function formatDuration(secs?: number): string {
  if (!secs || !Number.isFinite(secs)) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface SongRow {
  id: string;
  title: string;
  status: string;
  audioUrl?: string;
  audioDuration?: number;
  videoUrl?: string;
  youtubeVideoId?: string;
  theme?: string;
  createdAt?: string;
}

interface Props {
  songs: SongRow[];
  /** Map of song_id → 28-day play count from GA4 (empty when dim not registered). */
  playsBySongId: Record<string, number>;
  ga4PlaysWorking: boolean;
}

type StatusFilter = 'all' | 'PUBLISHED' | 'DRAFT';
type ThemeFilter = 'all' | SongTheme;

export function SongsTable({ songs, playsBySongId, ga4PlaysWorking }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [theme, setTheme] = useState<ThemeFilter>('all');
  const searchId = useId();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return songs.filter((s) => {
      if (status !== 'all' && s.status !== status) return false;
      if (theme !== 'all') {
        const effective = themeForSongWithOverride(s.id, s.theme);
        if (effective !== theme) return false;
      }
      if (q && !s.title.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [songs, search, status, theme]);

  const totalCols = ga4PlaysWorking ? 8 : 7;

  return (
    <>
      {/* Filter row */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor={searchId} className="mb-1 block text-xs font-medium text-gray-500">
            Search
          </label>
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title or id…"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            aria-label="Status filter"
          >
            <option value="all">All</option>
            <option value="PUBLISHED">Published</option>
            <option value="DRAFT">Draft</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Theme</label>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeFilter)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-tamil focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            aria-label="Theme filter"
          >
            <option value="all">All</option>
            {SONG_THEMES.map((t) => (
              <option key={t} value={t}>{SONG_THEME_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <p className="ml-auto text-xs text-gray-500">
          {filtered.length} of {songs.length}
        </p>
      </div>

      {/* Table — wrapped in overflow-x-auto so phones can scroll the wide grid */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Theme</th>
              <th className="px-4 py-3 text-right">Duration</th>
              <th className="px-4 py-3 text-center">Audio</th>
              <th className="px-4 py-3 text-center">YouTube</th>
              <th className="px-4 py-3 text-center">Status</th>
              {ga4PlaysWorking && <th className="px-4 py-3 text-right">Plays · 28d</th>}
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={totalCols} className="px-4 py-8 text-center text-gray-500">
                  No songs match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((s) => {
                const ytId = s.youtubeVideoId || getYouTubeId(s.videoUrl ?? '') || null;
                const effectiveTheme = themeForSongWithOverride(s.id, s.theme);
                const hasOverride = typeof s.theme === 'string' && s.theme.length > 0;
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-tamil font-medium text-gray-900">{s.title}</div>
                      <div className="text-[11px] text-gray-400">{s.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <ThemeSelect
                        songId={s.id}
                        initialTheme={effectiveTheme}
                        hasOverride={hasOverride}
                      />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">{formatDuration(s.audioDuration)}</td>
                    <td className="px-4 py-3 text-center">{s.audioUrl ? '✓' : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {ytId ? (
                        <a
                          href={`https://www.youtube.com/watch?v=${ytId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open YouTube video ${ytId} in new tab`}
                          className="text-orange-600 hover:underline"
                          title={ytId}
                        >
                          ↗
                        </a>
                      ) : (
                        <span className="text-gray-400" aria-label="No YouTube video linked">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          s.status === 'PUBLISHED'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    {ga4PlaysWorking && (
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {playsBySongId[s.id] != null ? numberFmt.format(playsBySongId[s.id]) : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2 text-xs">
                        <Link href={`/admin/content/${s.id}/edit`} className="text-orange-600 hover:underline">
                          Edit
                        </Link>
                        <Link
                          href={`/content/${s.id}`}
                          target="_blank"
                          aria-label={`View ${s.title} on the public site (new tab)`}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
