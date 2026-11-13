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
 * - `flush()` saves anything pending now and resolves with the edits the
 *   server holds. Upload and Make video call it first: both act on the
 *   STORED project, and Make video draws from exactly those edits.
 * - `hold` keeps edits local (nothing is dropped) while Make video is
 *   starting: the worker reads the stored blocks when it leaves `queued`, and
 *   the PNGs were drawn from the flushed ones. An edit saved in between would
 *   burn old text, or fail on a missing PNG for a new line. `flush()` ignores it;
 *   the save on unmount respects it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { VideoTextProject } from '@/types/videoText';

export const AUTOSAVE_DELAY_MS = 800;

export type Edits = Pick<VideoTextProject, 'name' | 'titleText' | 'creditsText' | 'lyricsText' | 'blocks' | 'style'> & {
  cut: VideoTextProject['cut'];
  freeze: VideoTextProject['freeze'];
  endTitles: VideoTextProject['endTitles'];
};

export const editsOf = (p: VideoTextProject): Edits => ({
  name: p.name,
  titleText: p.titleText,
  creditsText: p.creditsText,
  lyricsText: p.lyricsText,
  blocks: p.blocks,
  style: p.style,
  cut: p.cut ?? null,
  freeze: p.freeze ?? null,
  endTitles: p.endTitles ?? null,
});

/** `held`: edits are waiting for the render start-up to finish (see `hold`). */
export type AutosaveStatus = 'idle' | 'saving' | 'held' | 'saved' | 'error';

/**
 * What the server now holds — the exact edits PATCHed (parsed back from the
 * body sent) and the version they were saved at — or why not.
 */
export type FlushResult = { ok: true; edits: Edits; version: number } | { ok: false; error: string };

export function useAutosave(
  project: VideoTextProject,
  onVersion: (version: number) => void,
  { hold = false }: { hold?: boolean } = {},
): {
  status: AutosaveStatus;
  error: string | null;
  flush: () => Promise<FlushResult>;
  /** True while the screen holds edits the server does not (pending, held or failed). */
  isDirty: () => boolean;
  /** The next page unload is ours (a download): do not warn about it. */
  skipNextUnloadWarning: () => void;
} {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const snapshot = JSON.stringify(editsOf(project));
  const latest = useRef({ id: project.id, snapshot, edits: editsOf(project) });
  latest.current = { id: project.id, snapshot, edits: editsOf(project) };

  const savedSnapshot = useRef(snapshot);
  const savedEdits = useRef<Edits>(JSON.parse(snapshot) as Edits);
  const skipUnloadUntil = useRef(0);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const version = useRef(project.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<FlushResult> | null>(null);
  const mounted = useRef(true);
  const onVersionRef = useRef(onVersion);
  onVersionRef.current = onVersion;

  // Leaving the editor (Back, or another project) inside the debounce window
  // must not drop the last edits: send them on the way out — unless a render
  // is starting (hold): then they stay unsaved, and beforeunload warns.
  const flushRef = useRef<() => Promise<FlushResult>>(async () => ({
    ok: true,
    edits: savedEdits.current,
    version: version.current,
  }));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (!holdRef.current && latest.current.snapshot !== savedSnapshot.current) void flushRef.current();
    };
  }, []);

  /** Send the current edits once. */
  const saveNow = useCallback(async (): Promise<FlushResult> => {
    const { id, snapshot: sent } = latest.current;
    if (sent === savedSnapshot.current) return { ok: true, edits: savedEdits.current, version: version.current };
    // A detached copy of exactly what goes over the wire.
    const edits = JSON.parse(sent) as Edits;
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
      // Versions only go up. A late response must not roll back a newer one
      // (e.g. a re-upload's bump that landed meanwhile).
      if (body.version > version.current) {
        version.current = body.version;
        onVersionRef.current(body.version);
      }
      savedSnapshot.current = sent;
      savedEdits.current = edits;
      if (mounted.current) {
        setError(null);
        setStatus(latest.current.snapshot === sent ? 'saved' : holdRef.current ? 'held' : 'saving');
      }
      return { ok: true, edits, version: version.current };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (mounted.current) {
        setError(message);
        setStatus('error');
      }
      return { ok: false, error: message };
    }
  }, []);

  /**
   * Wait for any save in flight to settle, then save what is on screen now.
   * Resolves with the edits the server holds afterwards — Make video draws
   * from exactly these, never from live state.
   */
  const flush = useCallback(async (): Promise<FlushResult> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    while (inFlight.current) await inFlight.current;
    if (latest.current.snapshot === savedSnapshot.current) {
      return { ok: true, edits: savedEdits.current, version: version.current };
    }
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
    if (project.version > version.current) version.current = project.version;
    if (snapshot === savedSnapshot.current) return;
    if (timer.current) clearTimeout(timer.current);
    if (hold) {
      setStatus('held');
      return; // sent when the hold lifts (this effect re-runs)
    }
    setStatus('saving');
    timer.current = setTimeout(() => {
      timer.current = null;
      // A save in flight finishes first; flush then sends what is newer.
      void flush();
    }, AUTOSAVE_DELAY_MS);
  }, [snapshot, project.version, flush, hold]);

  // Closing the tab with unsaved edits (inside the 800 ms window, or held
  // while a render starts) would lose them: ask first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Date.now() < skipUnloadUntil.current) return;
      if (latest.current.snapshot === savedSnapshot.current) return;
      e.preventDefault();
      e.returnValue = ''; // older browsers only prompt when this is set
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const isDirty = useCallback(() => latest.current.snapshot !== savedSnapshot.current, []);
  const skipNextUnloadWarning = useCallback(() => {
    skipUnloadUntil.current = Date.now() + 3000;
  }, []);

  return { status, error, flush, isDirty, skipNextUnloadWarning };
}
