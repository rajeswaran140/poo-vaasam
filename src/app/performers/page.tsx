'use client';

/**
 * /performers (authed landing). Rendered by <PerformerGate> only once signed in.
 * Lists the performable songs (gated lyrics + backing track) via the
 * `requirePerformer`-gated /api/performers/songs, linking to each song's page.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { performerFetch } from '@/lib/client-auth';

interface PerformerSongItem {
  id: string;
  slug: string;
  title: string;
  artist: string;
  theme: string;
  coverUrl?: string;
  durationSeconds?: number;
}

function fmtDuration(s?: number): string {
  if (!s || s <= 0) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function PerformersHome() {
  const [songs, setSongs] = useState<PerformerSongItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    performerFetch('/api/performers/songs')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (active) setSongs(Array.isArray(d.data) ? d.data : []); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Failed to load songs'); });
    return () => { active = false; };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-kavivanar text-3xl text-orange-800">பாடல்களைப் பாடுங்கள் 🎤</h1>
        <p className="mt-1 font-tamil text-gray-600">
          Lyrics and karaoke backing tracks to learn and perform தமிழகவல் songs.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">Could not load songs: {error}</p>}

      {songs === null && !error && <p className="text-gray-500 font-tamil">ஏற்றுகிறது…</p>}

      {songs && songs.length === 0 && (
        <div className="rounded-xl border border-orange-100 bg-orange-50/60 p-5">
          <p className="font-tamil text-gray-700">விரைவில் — performable songs will appear here soon.</p>
        </div>
      )}

      {songs && songs.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {songs.map((s) => (
            <li key={s.id}>
              <Link
                href={`/performers/${s.id}`}
                className="group flex h-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 transition-colors hover:border-orange-300 hover:bg-orange-50/40"
              >
                {s.coverUrl ? (
                  <Image src={s.coverUrl} alt={s.title} width={56} height={56} className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-orange-100 text-xl">🎵</div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-tamil font-semibold text-gray-800 group-hover:text-orange-800" title={s.title}>{s.title}</p>
                  <p className="truncate text-xs text-gray-500">
                    {s.artist}{fmtDuration(s.durationSeconds) ? ` · ${fmtDuration(s.durationSeconds)}` : ''}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
