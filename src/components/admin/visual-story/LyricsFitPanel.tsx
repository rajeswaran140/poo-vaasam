'use client';

/**
 * Fit to the lyrics (design 2026-11-13, phase 1 "Keep my rows"): paste the
 * lyrics, listen to the story's own song (the same worker as Video Text), and
 * move every cut onto a line start or into the music. The rows keep their
 * count and order; made clips are trimmed or play a little slower
 * (visual-story-clip-fit.ts). Nothing is saved until Use these rows, and then
 * every row's seconds go in one write.
 */
import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { assemblyKindOf } from '@/lib/visual-story-assemble';
import { fitKeepRows, type FitRowIn, type FitRowOut, type WindowLine } from '@/lib/visual-story-lyric-fit';
import type { Candidate, Shot, VisualStory } from '@/types/visualStory';

interface Props {
  vsId: string;
  story: VisualStory;
  shots: Shot[];
  candidates: Candidate[];
  onChanged: () => void;
}

type Listen = 'idle' | 'running' | 'ready' | 'error';
type Fit = { rows: FitRowOut[]; staleCount: number };

const POLL_MS = 5_000;
const field = 'mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800';
const button = 'rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50';
const quiet = 'rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200';

/** 75.4 → "1:15.4" */
const clock = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = (Math.round((sec - m * 60) * 10) / 10).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};
const secs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function clipNote(r: FitRowOut): { text: string; stale: boolean } {
  const f = r.fit;
  if (!f) return { text: 'picture', stale: false };
  if (f.kind === 'exact') return { text: 'as is', stale: false };
  if (f.kind === 'trim') return { text: `trim ${secs(Math.round(f.trimSec * 10) / 10)} s`, stale: false };
  if (f.kind === 'slow') return { text: `plays at ${Math.round(f.rate * 100)} %`, stale: false };
  return { text: 'needs a new clip', stale: true };
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

export function LyricsFitPanel({ vsId, story, shots, candidates, onChanged }: Props) {
  const [lyrics, setLyrics] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string; lyricsText: string }>>([]);
  const [listen, setListen] = useState<Listen>('idle');
  const [heard, setHeard] = useState<{ heard: number; total: number } | null>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const base = `/api/admin/visual-story/${vsId}/lyric-timing`;

  const rows = [...shots].sort((a, b) => a.sceneOrder - b.sceneOrder || a.shotOrder - b.shotOrder);
  const windowSec = story.windowEndSec - story.windowStartSec;

  const poll = async () => {
    try {
      const body = await readJson(await adminFetch(base));
      if (!mounted.current) return;
      const status = body?.status as Listen | undefined;
      if (status === 'running') {
        setListen('running');
        timer.current = setTimeout(() => void poll(), POLL_MS);
      } else if (status === 'ready') setListen('ready');
      else if (status === 'error') {
        setListen('error');
        setError(String(body?.error ?? 'Listening failed. Try again.'));
      } else setListen('idle');
    } catch {
      if (mounted.current) setError('Could not check the listening. Try again.');
    }
  };

  useEffect(() => {
    mounted.current = true;
    void poll();
    void (async () => {
      try {
        const body = await readJson(await adminFetch('/api/admin/video-text'));
        const list = (body?.projects as Array<{ id: string; name: string; lyricsText?: string }> | undefined) ?? [];
        if (mounted.current) setProjects(list.filter((p) => p.lyricsText?.trim()).map((p) => ({ id: p.id, name: p.name, lyricsText: p.lyricsText! })));
      } catch {
        /* the Video Text shortcut is optional */
      }
    })();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per story
  }, [vsId]);

  const post = (body: unknown) =>
    adminFetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const startListening = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await post({ op: 'start' });
      const body = await readJson(res);
      if (!res.ok) {
        setError(String(body?.error ?? 'Listening could not be started. Try again.'));
        return;
      }
      if (body?.status === 'ready') setListen('ready');
      else {
        setListen('running');
        timer.current = setTimeout(() => void poll(), POLL_MS);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  /** What each row brings to the fitter: its chosen clip's length, and whether the next row continues from it. */
  const rowInputs = (): FitRowIn[] =>
    rows.map((s, i) => {
      const chosen = candidates.find((c) => c.candId === s.selectedCandidateId);
      const isClip = !!chosen && assemblyKindOf(chosen.s3Key) === 'clip';
      const next = rows[i + 1];
      return {
        clipSec: isClip && typeof chosen!.durationSec === 'number' ? chosen!.durationSec : null,
        isClip,
        isOwn: isClip && chosen!.providerId === 'upload',
        continuedFrom: !!next && !!next.chainFromPrevious && next.mode !== 'STILL' && s.mode !== 'STILL',
        currentSec: s.durationSec,
      };
    });

  const fitRows = async () => {
    setError(null);
    setFit(null);
    setBusy(true);
    try {
      const res = await post({ op: 'align', lyricsText: lyrics });
      const body = await readJson(res);
      if (!res.ok) {
        setError(String(body?.error ?? 'The lyrics could not be timed. Try again.'));
        return;
      }
      const lines = (body?.lines as WindowLine[]) ?? [];
      setHeard({ heard: Number(body?.heard ?? 0), total: Number(body?.total ?? lines.length) });
      const result = fitKeepRows(rowInputs(), lines, windowSec);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFit({ rows: result.rows, staleCount: result.staleCount });
    } catch {
      setError('The lyrics could not be timed. Try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const useRows = async () => {
    if (!fit) return;
    setError(null);
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/shots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'lengths',
          lengths: rows.map((s, i) => ({ sceneOrder: s.sceneOrder, shotOrder: s.shotOrder, durationSec: fit.rows[i].durationSec })),
        }),
      });
      const body = await readJson(res);
      if (!res.ok) {
        setError(String(body?.error ?? 'The rows could not be saved. Try again.'));
        return;
      }
      setFit(null);
      onChanged();
    } catch {
      setError('The rows could not be saved. Try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <section aria-label="Fit to the lyrics" className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Fit to the lyrics</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Moves every cut onto the start of a sung line or into the music. Your rows and clips stay; a clip is trimmed or plays a
        little slower (never below 88 %). Video Text still adds the words.
      </p>
      {projects.length > 0 && (
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          Use the lyrics from Video Text
          <select
            aria-label="Use the lyrics from Video Text"
            defaultValue=""
            onChange={(e) => {
              const p = projects.find((x) => x.id === e.target.value);
              if (p) setLyrics(p.lyricsText);
            }}
            className={field}
          >
            <option value="">Choose a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        Lyrics
        <span className="block text-xs text-gray-500 dark:text-gray-400">
          One line per lyric line, a blank line between verses, as in Video Text.
        </span>
        <textarea rows={4} maxLength={20000} value={lyrics} onChange={(e) => setLyrics(e.target.value)} className={field} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={quiet} disabled={busy || listen === 'running' || listen === 'ready'} onClick={startListening}>
          Listen to the song
        </button>
        <button type="button" className={button} disabled={busy || !lyrics.trim() || rows.length === 0} onClick={fitRows}>
          Fit the rows
        </button>
      </div>
      {listen === 'running' && (
        <p role="status" className="text-sm text-gray-700 dark:text-gray-300">
          Listening… a 4-minute song takes a few minutes.
        </p>
      )}
      {listen === 'ready' && !heard && <p className="text-sm text-gray-700 dark:text-gray-300">Listened. Press Fit the rows.</p>}
      {heard && (
        <p className="text-sm text-gray-700 dark:text-gray-300">{`${heard.heard} of ${heard.total} lines heard.`}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {fit && (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="py-1 pr-3">#</th>
                  <th className="py-1 pr-3">Time</th>
                  <th className="py-1 pr-3">Length</th>
                  <th className="py-1 pr-3">Lines</th>
                  <th className="py-1">Clip</th>
                </tr>
              </thead>
              <tbody>
                {fit.rows.map((r, i) => {
                  const note = clipNote(r);
                  return (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3">{i + 1}</td>
                      <td className="py-1 pr-3">{`${clock(r.startSec)}–${clock(r.endSec)}`}</td>
                      <td className="py-1 pr-3">{`${secs(r.durationSec)} s`}</td>
                      <td className="py-1 pr-3">{r.lines ? (r.lines[0] === r.lines[1] ? String(r.lines[0]) : `${r.lines[0]}–${r.lines[1]}`) : 'music'}</td>
                      <td className={`py-1 ${note.stale ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>{note.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">Every cut lands on a line start or in the music.</p>
          {fit.staleCount > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {`${fit.staleCount} row${fit.staleCount === 1 ? '' : 's'} need${fit.staleCount === 1 ? 's' : ''} a new clip; Make the video will make ${fit.staleCount === 1 ? 'it' : 'them'}.`}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className={button} disabled={busy} onClick={useRows}>
              Use these rows
            </button>
            <button type="button" className={quiet} disabled={busy} onClick={() => setFit(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
