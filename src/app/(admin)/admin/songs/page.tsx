/**
 * /admin/songs — audio song management dashboard.
 *
 * Server-rendered page that fetches all songs + GA4 play counts (by
 * immutable song_id, not by title — survives renames), then hands the
 * data to SongsTable for client-side filtering + the inline theme picker.
 */

import Link from 'next/link';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType } from '@/types/content';
import { fetchAudioPlaysBySongId, isGA4Configured } from '@/lib/ga4-api';
import { SongsTable, type SongRow } from '@/components/admin/SongsTable';

export const revalidate = 60;

function formatDuration(secs?: number): string {
  if (!secs || !Number.isFinite(secs)) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function getAllSongs(): Promise<SongRow[]> {
  try {
    const repo = new ContentRepository();
    const res = await repo.findByType(ContentType.SONGS, { limit: 200 });
    return res.items.map((entity) => {
      const o = entity.toObject() as Record<string, unknown>;
      // Normalise createdAt to a string so the client component (which can't
      // hydrate Date instances safely) gets a plain JSON-compatible payload.
      const createdAt = o.createdAt instanceof Date
        ? o.createdAt.toISOString()
        : typeof o.createdAt === 'string' ? o.createdAt : undefined;
      return {
        id: String(o.id),
        title: String(o.title ?? ''),
        status: String(o.status ?? 'DRAFT'),
        audioUrl: typeof o.audioUrl === 'string' ? o.audioUrl : undefined,
        audioDuration: typeof o.audioDuration === 'number' ? o.audioDuration : undefined,
        videoUrl: typeof o.videoUrl === 'string' ? o.videoUrl : undefined,
        youtubeVideoId: typeof o.youtubeVideoId === 'string' ? o.youtubeVideoId : undefined,
        theme: typeof o.theme === 'string' ? o.theme : undefined,
        createdAt,
      };
    });
  } catch (err) {
    console.error('[admin/songs] failed to load songs:', err);
    return [];
  }
}

export default async function AdminSongsPage() {
  const ga4On = isGA4Configured();
  const [songs, audioRes] = await Promise.all([
    getAllSongs(),
    ga4On ? fetchAudioPlaysBySongId(28) : Promise.resolve(null),
  ]);

  const playsBySongId: Record<string, number> = {};
  if (audioRes?.ok) {
    for (const row of audioRes.data.rows) playsBySongId[row.label] = row.eventCount;
  }
  const ga4PlaysWorking = !!audioRes?.ok && audioRes.data.note !== 'dimension-not-registered';

  const sorted = [...songs].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
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

      <details className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        <summary className="cursor-pointer text-gray-700">How this page works</summary>
        <div className="mt-2 space-y-1">
          <p>
            Theme changes save instantly (DB override beats the static map in <code>src/config/song-themes.ts</code>; pick &ldquo;Default&rdquo; in the dropdown to clear an override).
          </p>
          <p>For everything else — title, body, audio file, status — use the per-row <strong>Edit</strong> link.</p>
          {!ga4On && <p>GA4 not configured; play counts hidden.</p>}
          {ga4On && !ga4PlaysWorking && (
            <p>
              Play counts will appear once the <code>Song ID</code> GA4 custom dimension is registered (Admin → Custom definitions → Create custom dimension, scope: Event, parameter: <code>song_id</code>). The dashboard prefers <code>song_id</code> over <code>song_title</code> because it survives song renames.
            </p>
          )}
        </div>
      </details>

      <SongsTable songs={sorted} playsBySongId={playsBySongId} ga4PlaysWorking={ga4PlaysWorking} />
    </div>
  );
}
