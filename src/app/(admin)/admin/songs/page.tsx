/**
 * /admin/songs — audio song management dashboard.
 *
 * Server-rendered table view of every published song with theme picker,
 * duration, status, YouTube-link health, and (when GA4 Song Title custom
 * dimension is registered) play count. Theme picker is the only inline
 * editable bit — everything else links out to the canonical pages
 * (/admin/content/[id]/edit for full edit, /content/[id] for the public
 * page).
 */

import Link from 'next/link';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType } from '@/types/content';
import { themeForSongWithOverride } from '@/config/song-themes';
import {
  fetchAudioPlays,
  isGA4Configured,
} from '@/lib/ga4-api';
import { ThemeSelect } from '@/components/admin/ThemeSelect';
import { getYouTubeId } from '@/lib/utils/youtube';

export const revalidate = 60; // shorter than the main YouTube dashboard — admin actions need fast feedback

const numberFmt = new Intl.NumberFormat('en-US');

function formatDuration(secs?: number): string {
  if (!secs || !Number.isFinite(secs)) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface SongObject {
  id: string;
  title: string;
  status: string;
  audioUrl?: string;
  audioDuration?: number;
  videoUrl?: string;
  youtubeVideoId?: string;
  theme?: string;
  createdAt?: string | Date;
}

async function getAllSongs(): Promise<SongObject[]> {
  try {
    const repo = new ContentRepository();
    const res = await repo.findByType(ContentType.SONGS, { limit: 200 });
    return res.items.map((entity) => entity.toObject() as SongObject);
  } catch (err) {
    console.error('[admin/songs] failed to load songs:', err);
    return [];
  }
}

export default async function AdminSongsPage() {
  const ga4On = isGA4Configured();
  const [songs, audioRes] = await Promise.all([
    getAllSongs(),
    ga4On ? fetchAudioPlays(28) : Promise.resolve(null),
  ]);

  // Index audio plays by song title (event param) so we can pin a count to
  // each row. Falls back to undefined when the dimension isn't registered or
  // GA4 isn't reachable.
  const playsByTitle = new Map<string, number>();
  if (audioRes?.ok) {
    for (const row of audioRes.data.rows) playsByTitle.set(row.label, row.eventCount);
  }
  const ga4PlaysWorking = audioRes?.ok && audioRes.data.note !== 'dimension-not-registered';

  const sorted = [...songs].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
    return tb - ta;
  });

  const publishedCount = songs.filter((s) => s.status === 'PUBLISHED').length;
  const draftCount = songs.length - publishedCount;
  const totalDuration = songs.reduce((sum, s) => sum + (s.audioDuration ?? 0), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Songs</h1>
          <p className="text-sm text-gray-500">
            {publishedCount} published{draftCount > 0 ? ` · ${draftCount} draft` : ''} · {formatDuration(totalDuration)} total
          </p>
        </div>
        <Link
          href="/admin/content/new"
          className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
        >
          + New song
        </Link>
      </header>

      <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        Theme changes here save instantly (DB override beats the static map in <code>src/config/song-themes.ts</code>).
        For everything else — title, body, audio file, status — use the per-row <strong>Edit</strong> link.
        {!ga4On && ' GA4 not configured; play counts hidden.'}
        {ga4On && !ga4PlaysWorking && ' Play counts will appear once the `Song Title` GA4 custom dimension is registered (Admin → Custom definitions → param: song_title).'}
      </p>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
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
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={ga4PlaysWorking ? 8 : 7} className="px-4 py-8 text-center text-gray-500">
                  No songs yet. Add one via <strong>+ New song</strong> or the upload script.
                </td>
              </tr>
            ) : (
              sorted.map((s) => {
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
                          className="text-orange-600 hover:underline"
                          title={ytId}
                        >
                          ↗
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          s.status === 'PUBLISHED'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    {ga4PlaysWorking && (
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {playsByTitle.has(s.title) ? numberFmt.format(playsByTitle.get(s.title)!) : '—'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2 text-xs">
                        <Link href={`/admin/content/${s.id}/edit`} className="text-orange-600 hover:underline">
                          Edit
                        </Link>
                        <Link href={`/content/${s.id}`} target="_blank" className="text-gray-500 hover:text-gray-700">
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
    </div>
  );
}
