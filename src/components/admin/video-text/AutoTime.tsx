'use client';

/**
 * Time lyrics automatically: the lyric-timing worker listens to the video once
 * (about 6 minutes for a 4-minute song), then every line is placed where it is
 * sung. Raj's words never change; only their times do. Lines the recogniser did
 * not hear are listed so he checks those first, and Undo puts the timeline back
 * in one press. Re-timing after a lyric edit reuses what was heard (a second).
 *
 * Server: /api/admin/video-text/[id]/lyric-timing. Maths: lib/video-text/lyric-timing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { applyTimedLines, linesAndVerses, type TimedLine } from '@/lib/video-text/lyric-timing';
import { validateBlocks } from '@/lib/video-text/timeline';
import type { TextBlock } from '@/types/videoText';

export interface AutoTimeProps {
  projectId: string;
  /** The current video; a new upload means listening again. */
  sourceKey: string;
  durationSec: number;
  lyricsText: string;
  blocks: TextBlock[];
  onChange(blocks: TextBlock[]): void;
  disabled?: boolean;
  /** Poll interval while the worker listens. */
  pollMs?: number;
}

type Phase = 'idle' | 'starting' | 'running' | 'aligning';

const BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

const minutesFor = (sec: number) => Math.max(2, Math.round((sec * 1.5) / 60) + 1);

let idSeq = 0;
const makeId = () => `lt${Date.now().toString(36)}${(idSeq++).toString(36)}`;

export function AutoTime({ projectId, sourceKey, durationSec, lyricsText, blocks, onChange, disabled, pollMs = 10_000 }: AutoTimeProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ unheard: number[]; total: number } | null>(null);
  const [snapshot, setSnapshot] = useState<TextBlock[] | null>(null);
  const live = useRef({ blocks, lyricsText });
  live.current = { blocks, lyricsText };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const base = `/api/admin/video-text/${projectId}/lyric-timing`;

  const align = useCallback(async () => {
    setPhase('aligning');
    setError(null);
    try {
      const res = await adminFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'align', lyricsText: live.current.lyricsText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not time the lines. Try again.');
      const lines = body.lines as TimedLine[];
      const before = live.current.blocks;
      const next = applyTimedLines(before, lines, makeId);
      const problem = validateBlocks(next, durationSec);
      if (problem) throw new Error(problem);
      if (!mounted.current) return;
      setSnapshot(before);
      onChange(next);
      setResult({ unheard: lines.flatMap((l, i) => (l.heard ? [] : [i + 1])), total: lines.length });
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not time the lines. Try again.');
    } finally {
      if (mounted.current) setPhase('idle');
    }
  }, [base, durationSec, onChange]);

  const poll = useCallback(async () => {
    try {
      const res = await adminFetch(base);
      const body = await res.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!res.ok) throw new Error(body?.error || 'Could not check automatic timing.');
      if (body.status === 'running') {
        setPhase('running');
        timer.current = setTimeout(() => void poll(), pollMs);
        return;
      }
      if (body.status === 'ready') {
        setReady(true);
        await align();
        return;
      }
      if (body.status === 'error') setError(body.error);
      setPhase('idle');
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Could not check automatic timing.');
      setPhase('idle');
    }
  }, [align, base, pollMs]);

  // On open (and after a new upload): pick up a run already listening, or note
  // that this video was listened to before, without changing any timing.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setResult(null);
    setSnapshot(null);
    setError(null);
    void (async () => {
      try {
        const res = await adminFetch(base);
        const body = await res.json().catch(() => ({}));
        if (cancelled || !mounted.current || !res.ok) return;
        if (body.status === 'ready') setReady(true);
        if (body.status === 'running') {
          setPhase('running');
          timer.current = setTimeout(() => void poll(), pollMs);
        }
      } catch {
        /* the button still works; it reports its own errors */
      }
    })();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check only when the video changes
  }, [base, sourceKey]);

  const start = async () => {
    setError(null);
    setResult(null);
    if (ready) return void align();
    setPhase('starting');
    try {
      const res = await adminFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'start' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Automatic timing could not be started. Try again.');
      if (body.status === 'ready') {
        setReady(true);
        return void align();
      }
      setPhase('running');
      timer.current = setTimeout(() => void poll(), pollMs);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : 'Automatic timing could not be started. Try again.');
      setPhase('idle');
    }
  };

  const undo = () => {
    if (!snapshot) return;
    onChange(snapshot);
    setSnapshot(null);
    setResult(null);
  };

  const { lines } = linesAndVerses(lyricsText);
  if (lines.length === 0) return null;
  const busy = phase !== 'idle';

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2" data-testid="auto-time">
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled || busy}
        className={`${BUTTON} bg-orange-600 text-white hover:bg-orange-700`}
      >
        {phase === 'starting' || phase === 'running'
          ? 'Listening to the song…'
          : phase === 'aligning'
            ? 'Timing the lines…'
            : ready
              ? 'Time lyrics automatically (about a second)'
              : 'Time lyrics automatically'}
      </button>
      {snapshot && !busy && (
        <button
          type="button"
          onClick={undo}
          className={`${BUTTON} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800`}
        >
          Undo automatic timing
        </button>
      )}
      <p className="w-full text-xs text-gray-500 dark:text-gray-400">
        {phase === 'running'
          ? `Listening takes about ${minutesFor(durationSec)} minutes for this video. You can keep working; the lines move when it is done.`
          : 'Listens to the singing and places each line where it is sung. Your words are never changed. Keep a blank line between verses: a verse is placed after a music break.'}
      </p>
      {result && (
        <p role="status" className="w-full text-sm text-gray-700 dark:text-gray-200">
          {result.unheard.length === 0
            ? `Timed all ${result.total} lines.`
            : `Timed ${result.total} lines. ${result.unheard.length} were not heard clearly and were placed in the singing around them; check these first: line${result.unheard.length === 1 ? '' : 's'} ${result.unheard.join(', ')}.`}
        </p>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
