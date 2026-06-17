'use client';

/**
 * /performers/[id] — a single performable song (gated). Fetches the gated lyrics
 * + a presigned backing-track URL from /api/performers/songs/[id] and renders
 * the lyrics alongside the BackingTrackPlayer. The presigned URL is short-lived;
 * if it expires (playback error), we transparently re-fetch a fresh one.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { performerFetch } from '@/lib/client-auth';
import { BackingTrackPlayer } from '@/components/performers/BackingTrackPlayer';

interface SongDetail {
  id: string;
  slug: string;
  title: string;
  artist: string;
  theme: string;
  coverUrl?: string;
  lyrics: string;
  durationSeconds?: number;
}

export default function PerformerSongPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [song, setSong] = useState<SongDetail | null>(null);
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const res = await performerFetch(`/api/performers/songs/${id}`);
      if (res.status === 404) { setError('This song is not available to perform yet.'); setLoading(false); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setSong(d.song);
      setTrackUrl(typeof d.instrumentalUrl === 'string' ? d.instrumentalUrl : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load song');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <Link href="/performers" className="inline-block text-sm text-orange-700 hover:underline">← எல்லா பாடல்களும்</Link>

      {loading && <p className="text-gray-500 font-tamil">ஏற்றுகிறது…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {song && (
        <>
          <div>
            <h1 className="font-kavivanar text-3xl text-orange-800">{song.title}</h1>
            <p className="mt-1 text-sm text-gray-500">{song.artist}</p>
          </div>

          {trackUrl && (
            <BackingTrackPlayer src={trackUrl} title={song.title} coverUrl={song.coverUrl} onExpired={load} />
          )}

          <article className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 font-tamil text-lg font-semibold text-gray-800">பாடல் வரிகள்</h2>
            <pre className="whitespace-pre-wrap font-tamil text-base leading-relaxed text-gray-800">{song.lyrics}</pre>
          </article>

          <p className="text-xs text-gray-400 font-tamil">
            தனிப்பட்ட பயன்பாட்டிற்கு மட்டும் · For personal, non-commercial performance only.
          </p>
        </>
      )}
    </div>
  );
}
