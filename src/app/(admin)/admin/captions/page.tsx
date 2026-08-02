'use client';

/**
 * /admin/captions — time a song's stored lyrics against its own YouTube
 * auto-caption track, and LOOK at the result before anything is published.
 *
 * This screen exists because the opposite happened once: a lyrics track was
 * uploaded to a 6:24 song with placeholder timings, on the assumption that
 * YouTube's sync flag would re-time it. It doesn't — uploaded cue times are
 * used verbatim — so all 20 cues sat inside the first 80 seconds and the song
 * carried unusable captions until a viewer noticed. Preview is therefore the
 * product here; publishing is a separate, deliberate step.
 */

import { useCallback, useEffect, useState } from 'react';
import { Captions, RefreshCw, AlertTriangle, CheckCircle2, Music } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';

interface SongRow {
  id: string;
  title: string;
  youtubeVideoId: string | null;
  hasBody: boolean;
  cardCount: number;
}
interface Cue {
  startMs: number;
  endMs: number;
  text: string;
  anchored: boolean;
}
interface Preview {
  title: string;
  videoId: string;
  asrCueCount: number;
  totalLines: number;
  anchoredLines: number;
  interpolatedLines: number;
  textPreserved: boolean;
  warnings: string[];
  cues: Cue[];
}

const mmss = (ms: number) => {
  const t = Math.round(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export default function CaptionsPage() {
  const [songs, setSongs] = useState<SongRow[]>([]);
  const [ready, setReady] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/captions');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSongs(json.songs);
      setReady(json.ready);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load songs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runPreview = async (id: string) => {
    setBusy(id);
    setError(null);
    setPreview(null);
    try {
      const res = await adminFetch('/api/admin/captions/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPreview(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {ready} song{ready === 1 ? '' : 's'} have both stored lyrics and a linked video
        </p>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Preview only — nothing is uploaded to YouTube from this screen. Timings are derived from the
        video&apos;s own auto-caption track; your words are used verbatim and never the recogniser&apos;s.
      </p>

      {error && (
        <p className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      )}
      {loading && <p className="text-gray-500">Loading…</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="rounded-lg border border-gray-200 bg-white">
          <ul className="divide-y divide-gray-100">
            {songs.map((s) => {
              const usable = s.hasBody && !!s.youtubeVideoId;
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-tamil text-sm text-gray-900" title={s.title}>{s.title}</p>
                    <p className="text-xs text-gray-400">
                      {s.hasBody ? `${s.cardCount} cards` : 'no lyrics stored'}
                      {s.youtubeVideoId ? ` · ${s.youtubeVideoId}` : ' · no linked video'}
                    </p>
                  </div>
                  <button
                    disabled={!usable || busy === s.id}
                    onClick={() => void runPreview(s.id)}
                    className="shrink-0 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    {busy === s.id ? 'Aligning…' : 'Preview timings'}
                  </button>
                </li>
              );
            })}
            {!loading && !songs.length && <li className="px-4 py-6 text-sm text-gray-400">No songs found.</li>}
          </ul>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          {!preview ? (
            <p className="flex items-center gap-2 text-sm text-gray-400">
              <Captions className="h-4 w-4" /> Pick a song to see where each card would land.
            </p>
          ) : (
            <>
              <h3 className="font-tamil text-sm font-semibold text-gray-900">{preview.title}</h3>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>{preview.asrCueCount} ASR cues</span>
                <span>{preview.anchoredLines}/{preview.totalLines} lines anchored</span>
                <span>{preview.interpolatedLines} interpolated</span>
              </div>

              {preview.textPreserved ? (
                <p className="mt-3 flex items-center gap-2 text-xs text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Your text is preserved character-for-character.
                </p>
              ) : (
                <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-rose-700">
                  <AlertTriangle className="h-4 w-4" /> Text changed — do not publish this.
                </p>
              )}

              {preview.warnings.map((w) => (
                <p key={w} className="mt-2 flex items-start gap-2 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
                </p>
              ))}

              <ul className="mt-4 space-y-1">
                {preview.cues.map((c, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-sm">
                    <span className="w-12 shrink-0 tabular-nums text-gray-400">{mmss(c.startMs)}</span>
                    <span
                      className={`w-16 shrink-0 text-[10px] uppercase tracking-wide ${
                        c.anchored ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                    >
                      {c.anchored ? 'anchored' : 'interp'}
                    </span>
                    <span className="truncate font-tamil text-gray-700" title={c.text}>
                      {c.text.split('\n')[0]}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-4 flex items-start gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
                <Music className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Check card 1 lands on the vocal entry, that instrumental breaks show as gaps, and that
                repeated refrains are spread rather than bunched.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
