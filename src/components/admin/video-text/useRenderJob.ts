'use client';

/**
 * Make video, start to finish:
 *   0. prepare(): save the project, get back the exact saved state;
 *   1. ensureFonts();
 *   2. draw every block to a PNG at the video's size, 4 at a time;
 *   3. POST overlays, then upload every PNG (4 at a time);
 *   4. POST render;
 *   5. poll GET /[id] every 4 s while the render is in flight.
 *
 * A double click is guarded by a ref, not by state (state lags a render).
 * On mount, a render already in flight is polled again — its PNGs were drawn
 * and uploaded when it started, so nothing is redrawn.
 *
 * A poll read that fails, or that still shows an older render (an eventually
 * consistent read right after the claim), is skipped. The wait ends when the
 * server stops writing progress for as long as it takes the render slot to go
 * stale (20 min, RENDER_STALE_MS in VideoTextRepository) — a 10-minute song
 * legitimately takes a while — with a 40-minute backstop for reads that keep
 * failing, and a stop if another tab's render takes the slot.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';
import { ensureFonts, renderBlockPng } from '@/lib/video-text/draw';
import type { RenderState, RenderStatus, TextBlock, TextStyle, VideoTextProject } from '@/types/videoText';

export const POLL_INTERVAL_MS = 4000;
/** Mirrors RENDER_STALE_MS (server code, not importable here). */
const STALE_MS = 20 * 60 * 1000;
const PARALLEL = 4;

const IN_FLIGHT: RenderStatus[] = ['queued', 'segmenting', 'encoding', 'joining'];
export const isInFlight = (r: RenderState) => IN_FLIGHT.includes(r.status);

const STOPPED = 'The render stopped responding — press Make video to try again.';
const SUPERSEDED = 'Another render replaced this one — reload to see it.';
const TOO_LONG = 'The render is taking longer than expected — reload to check on it.';
/** A backstop only: the worker's own limit is 900 s, the slot goes stale after 20 min. */
const MAX_WAIT_MS = 40 * 60 * 1000;

type Phase =
  | { kind: 'saving' }
  | { kind: 'drawing'; done: number; total: number }
  | { kind: 'uploading'; done: number; total: number }
  | { kind: 'server' };

/** One saved state of the project: what the PNGs are drawn from. */
export interface RenderSnapshot {
  blocks: TextBlock[];
  frame: { width: number; height: number };
  style: TextStyle;
  /** The project version these blocks were saved at; the render is claimed only at it. */
  version: number;
}

export interface RenderInput {
  /**
   * Saves the project and resolves with the exact state the server now holds
   * (the editor: autosave flush → its PATCHed edits), or a message that stops
   * the render. The PNGs are drawn from this object, never from live state.
   */
  prepare: () => Promise<RenderSnapshot | string>;
}

const isFresh = (r: RenderState) =>
  !r.updatedAt || Date.now() - new Date(r.updatedAt).getTime() < STALE_MS;

/** `items` through `fn`, `PARALLEL` at a time, in order; `onDone` after each. */
async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R>, onDone: (n: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      onDone(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, lane));
  return out;
}

function newRenderId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function readProject(projectId: string): Promise<VideoTextProject | null> {
  try {
    const res = await adminFetch(`/api/admin/video-text/${projectId}`);
    if (!res.ok) return null;
    const body = await res.json();
    return (body?.project as VideoTextProject) ?? null;
  } catch {
    return null;
  }
}

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function stageLabel(phase: Phase | null, render: RenderState): string | null {
  if (phase?.kind === 'saving') return 'Saving…';
  if (phase?.kind === 'drawing') return `Drawing text ${phase.done}/${phase.total}…`;
  if (phase?.kind === 'uploading') return `Uploading text ${phase.done}/${phase.total}…`;
  switch (render.status) {
    case 'queued':
      return 'Starting…';
    case 'segmenting':
      return 'Splitting…';
    case 'encoding':
      return render.progress ? `Encoding ${render.progress.done}/${render.progress.total}` : 'Encoding…';
    case 'joining':
      return 'Joining…';
    default:
      return phase ? 'Starting…' : null;
  }
}

export function useRenderJob(projectId: string, initial: RenderState) {
  const resume = isInFlight(initial) && isFresh(initial) && Boolean(initial.renderId);
  const [render, setRender] = useState<RenderState>(initial);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [running, setRunning] = useState(resume);
  const [error, setError] = useState<string | null>(() => {
    if (initial.status === 'error') return initial.error;
    // In flight on paper, but silent for longer than the slot's stale time:
    // say so, rather than showing nothing beside an enabled button.
    if (isInFlight(initial) && !isFresh(initial)) return STOPPED;
    return null;
  });
  const [startedAt, setStartedAt] = useState<number | null>(() => {
    if (!resume) return null;
    const t = initial.startedAt ? new Date(initial.startedAt).getTime() : NaN;
    return Number.isFinite(t) ? t : Date.now();
  });
  const [now, setNow] = useState(() => Date.now());

  const busy = useRef(resume);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Elapsed-time clock, only while running.
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  /** Poll until this render finishes. Throws the render's own error. */
  const poll = useCallback(
    async (renderId: string) => {
      const deadline = Date.now() + MAX_WAIT_MS;
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (!mounted.current) return;
        if (Date.now() > deadline) throw new Error(TOO_LONG);
        const fresh = await readProject(projectId);
        if (!mounted.current) return;
        const r = fresh?.render;
        if (!r) continue;
        // The first reads may still show the previous render (eventual
        // consistency); a different id after that means another tab took over.
        if (r.renderId !== renderId) {
          if (attempt >= 3) throw new Error(SUPERSEDED);
          continue;
        }
        setRender(r);
        if (r.status === 'done') return;
        if (r.status === 'error') throw new Error(r.error || 'The render failed.');
        if (!isFresh(r)) throw new Error(STOPPED);
      }
    },
    [projectId],
  );

  const finish = useCallback((err: unknown) => {
    busy.current = false;
    if (!mounted.current) return;
    if (err) setError(err instanceof Error ? err.message : String(err));
    setPhase(null);
    setRunning(false);
  }, []);

  // Resume a render that was in flight when the page loaded.
  const resumeId = useRef(resume ? initial.renderId : null);
  useEffect(() => {
    const id = resumeId.current;
    if (!id) return;
    resumeId.current = null;
    poll(id).then(() => finish(null), finish);
  }, [poll, finish]);

  const start = useCallback(
    async (input: RenderInput) => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      setRunning(true);
      setStartedAt(Date.now());
      setPhase({ kind: 'saving' });
      try {
        const snap = await input.prepare();
        if (typeof snap === 'string') throw new Error(snap);
        const { blocks, frame, style, version } = snap;
        const total = blocks.length;
        setPhase({ kind: 'drawing', done: 0, total });
        await ensureFonts(style);
        const pngs = await inBatches(
          blocks,
          (b) => renderBlockPng(b, frame, style),
          (n) => mounted.current && setPhase({ kind: 'drawing', done: n, total }),
        );

        const renderId = newRenderId();
        const res = await adminFetch(`/api/admin/video-text/${projectId}/overlays`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ renderId, blockIds: blocks.map((b) => b.id) }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(body?.uploads)) {
          throw new Error(body?.error || `Could not prepare the text upload (HTTP ${res.status}).`);
        }
        const uploads = body.uploads as Array<{ blockId: string; url: string; fields: Record<string, string> }>;
        const pngFor = new Map(blocks.map((b, i) => [b.id, pngs[i]]));
        setPhase({ kind: 'uploading', done: 0, total: uploads.length });
        const signal = new AbortController().signal;
        await inBatches(
          uploads,
          (u) => {
            const png = pngFor.get(u.blockId);
            if (!png) throw new Error('Some text blocks are not in this project — reload and try again.');
            const file = new File([png], `${u.blockId}.png`, { type: 'image/png' });
            return putToS3(u.url, u.fields, file, () => {}, signal);
          },
          (n) => mounted.current && setPhase({ kind: 'uploading', done: n, total: uploads.length }),
        );

        const started = await adminFetch(`/api/admin/video-text/${projectId}/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ renderId, version }),
        });
        if (started.status !== 202) {
          const b = await started.json().catch(() => ({}));
          throw new Error(b?.error || `Could not start the render (HTTP ${started.status}).`);
        }
        if (!mounted.current) return;
        setPhase({ kind: 'server' });
        setRender((r) => ({ ...r, renderId, status: 'queued', progress: null, error: null, outputKey: null }));
        await poll(renderId);
        finish(null);
      } catch (err) {
        finish(err);
      }
    },
    [projectId, poll, finish],
  );

  const label = running ? stageLabel(phase, render) : null;
  const elapsed = running && startedAt ? mmss((now - startedAt) / 1000) : null;

  return {
    render,
    running,
    /** True until the worker has read the stored blocks (it leaves `queued`); autosave holds meanwhile. */
    startingUp: running && (phase?.kind === 'saving' || phase?.kind === 'drawing' || phase?.kind === 'uploading' || render.status === 'queued'),
    error,
    /** e.g. "Encoding 7/18 · 2:14" while running, else null. */
    stage: label ? `${label}${elapsed ? ` · ${elapsed}` : ''}` : null,
    start,
  };
}
