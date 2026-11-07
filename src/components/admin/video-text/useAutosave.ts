'use client';

/**
 * Autosave for a Video Text project: one PATCH 800 ms after the last change,
 * carrying the version the server last gave us.
 *
 * - At most one PATCH is in flight. Two at once would carry the same version
 *   and the second would 409 against our own first.
 * - A failed save never drops edits: they stay in the editor, the snapshot is
 *   not marked saved, and the next change (or flush) sends everything again.
 * - A version bump from elsewhere (POST /source, R9) arrives as a new
 *   `project.version`; the hook adopts it for the next PATCH.
 * - `flush()` saves anything pending now and says whether the server has it.
 *   Upload and Make video call it first: both act on the STORED project.
 * - `hold` keeps edits local (nothing is dropped) while Make video is
 *   starting: the worker reads the stored blocks when it leaves `queued`, and
 *   the PNGs were drawn from the flushed ones. An edit saved in between would
 *   burn old text, or fail on a missing PNG for a new line. `flush()` ignores it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { VideoTextProject } from '@/types/videoText';

export const AUTOSAVE_DELAY_MS = 800;

export type Edits = Pick<VideoTextProject, 'name' | 'titleText' | 'creditsText' | 'lyricsText' | 'blocks' | 'style'>;

export const editsOf = (p: VideoTextProject): Edits => ({
  name: p.name,
  titleText: p.titleText,
  creditsText: p.creditsText,
  lyricsText: p.lyricsText,
  blocks: p.blocks,
  style: p.style,
});

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useAutosave(
  project: VideoTextProject,
  onVersion: (version: number) => void,
  { hold = false }: { hold?: boolean } = {},
): { status: AutosaveStatus; error: string | null; flush: () => Promise<boolean> } {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const snapshot = JSON.stringify(editsOf(project));
  const latest = useRef({ id: project.id, snapshot, edits: editsOf(project) });
  latest.current = { id: project.id, snapshot, edits: editsOf(project) };

  const savedSnapshot = useRef(snapshot);
  const version = useRef(project.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);
  const onVersionRef = useRef(onVersion);
  onVersionRef.current = onVersion;

  // Leaving the editor (Back, or another project) inside the debounce window
  // must not drop the last edits: send them on the way out.
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (latest.current.snapshot !== savedSnapshot.current) void flushRef.current();
    };
  }, []);

  /** Send the current edits once. Resolves true when the server has them. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    const { id, snapshot: sent, edits } = latest.current;
    if (sent === savedSnapshot.current) return true;
    setStatus('saving');
    try {
      const res = await adminFetch(`/api/admin/video-text/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edits, version: version.current }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body?.version !== 'number') {
        throw new Error(body?.error || `Could not save the project (HTTP ${res.status}).`);
      }
      version.current = body.version;
      savedSnapshot.current = sent;
      onVersionRef.current(body.version);
      if (mounted.current) {
        setError(null);
        setStatus(latest.current.snapshot === sent ? 'saved' : 'saving');
      }
      return true;
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
      return false;
    }
  }, []);

  /** Wait for any save in flight, then save what is pending. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    while (inFlight.current) await inFlight.current;
    if (latest.current.snapshot === savedSnapshot.current) return true;
    const run = saveNow();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [saveNow]);

  flushRef.current = flush;

  useEffect(() => {
    // A version bump we did not make: the server rewrote the project (a new
    // upload). Adopt it, but do not assume it holds everything on screen —
    // text typed during the upload is still unsaved — so fall through and let
    // the diff decide. At worst that is one redundant PATCH.
    if (project.version !== version.current) version.current = project.version;
    if (snapshot === savedSnapshot.current) return;
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    if (hold) return; // sent when the hold lifts (this effect re-runs)
    timer.current = setTimeout(() => {
      timer.current = null;
      // A save in flight finishes first; flush then sends what is newer.
      void flush();
    }, AUTOSAVE_DELAY_MS);
  }, [snapshot, project.version, flush, hold]);

  // Closing the tab inside the 800 ms window would lose the last keystrokes.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current.snapshot !== savedSnapshot.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return { status, error, flush };
}
