'use client';

/**
 * The studio's render panel (Phase 6, spec §10): joins every shot's chosen
 * picture or clip with the song into one MP4. Shows what is still missing,
 * an estimate of how long the render takes, progress while the worker runs
 * (polled, resumed after a reload), and the finished video with a download.
 * The server decides every refusal; its words render here, beside the button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { delay } from '@/lib/poll-job';
import { estimateAssembleSec, MAX_ASSEMBLE_SEC } from '@/lib/visual-story-assemble';
import type { Candidate, RenderJob, Shot, VisualStory } from '@/types/visualStory';
import { usePlayUrl } from './ui-utils';

const POLL_INTERVAL_MS = 4000;
/** The worker's lifetime plus margin; past it the server fails the render anyway. */
const POLL_TIMEOUT_MS = 17 * 60_000;

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const minutes = (sec: number) => (sec < 90 ? 'about a minute' : `about ${Math.round(sec / 60)} minutes`);

interface Props {
  vsId: string;
  story: Pick<VisualStory, 'aspectRatio' | 'windowStartSec' | 'windowEndSec'>;
  shots: Shot[];
  candidates: Candidate[];
  renders: RenderJob[];
  onChanged: () => void;
}

export function RenderPanel({ vsId, story, shots, candidates, renders, onChanged }: Props) {
  const newestFirst = [...renders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = newestFirst[0] ?? null;
  /** A failed or running re-render does not hide the last video that worked. */
  const lastDone = newestFirst.find((r) => r.status === 'done' && r.s3Key) ?? null;
  const [current, setCurrent] = useState<RenderJob | null>(latest);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  /** Synchronous, so a double click cannot start two renders before state updates. */
  const startingRef = useRef(false);
  const pollAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pollAbort.current?.abort();
    };
  }, []);

  // A newer render from the reloaded tree replaces what is shown.
  useEffect(() => {
    if (latest && (!current || latest.createdAt > current.createdAt || latest.renderId === current.renderId)) setCurrent(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.renderId, latest?.status]);

  const poll = useCallback(
    async (renderId: string) => {
      pollAbort.current?.abort();
      const ctrl = new AbortController();
      pollAbort.current = ctrl;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (!ctrl.signal.aborted && mounted.current) {
        await delay(POLL_INTERVAL_MS, ctrl.signal);
        if (ctrl.signal.aborted || !mounted.current) return;
        try {
          const res = await adminFetch(`/api/admin/visual-story/${vsId}/render/${renderId}`, { signal: ctrl.signal });
          const body = await res.json().catch(() => null);
          const render = body?.data?.render as RenderJob | undefined;
          if (res.status === 404) {
            setCurrent(null);
            setError(body?.error || 'That render no longer exists.');
            return;
          }
          if (res.ok && render) {
            setCurrent(render);
            if (render.status === 'done' || render.status === 'failed') {
              onChanged();
              return;
            }
          }
        } catch {
          if (ctrl.signal.aborted) return;
          // A dropped poll is retried on the next tick.
        }
        if (Date.now() > deadline) {
          // Stop showing it as running: the button comes back, and the server
          // says so if it really is still going.
          setCurrent(null);
          setError('The render is taking longer than expected. Reload the page in a few minutes to see it.');
          return;
        }
      }
    },
    [vsId, onChanged]
  );

  // Resume watching a render that was running when the page loaded.
  useEffect(() => {
    if (latest && (latest.status === 'queued' || latest.status === 'running')) void poll(latest.renderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.renderId]);

  const chosen = shots.filter((s) => s.selectedCandidateId && candidates.some((c) => c.candId === s.selectedCandidateId));
  const windowSec = story.windowEndSec - story.windowStartSec;
  const total = shots.reduce((n, s) => n + s.durationSec, 0);
  const estimate = estimateAssembleSec(
    chosen.map((s) => ({ key: candidates.find((c) => c.candId === s.selectedCandidateId)!.s3Key, durationSec: s.durationSec }))
  );
  const missing = shots.length - chosen.length;
  const inFlight = current?.status === 'queued' || current?.status === 'running';
  const ready = shots.length > 0 && missing === 0 && total === windowSec && estimate <= MAX_ASSEMBLE_SEC;

  const start = async () => {
    if (startingRef.current || inFlight) return;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/render`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error || 'Could not start the render.');
        return;
      }
      const now = new Date().toISOString();
      setCurrent({
        renderId: body.data.renderId, status: 'queued', aspectRatio: story.aspectRatio, windowStartSec: story.windowStartSec,
        windowEndSec: story.windowEndSec, shots: [], estimateSec: body.data.estimateSec, createdAt: now, updatedAt: now,
      });
      void poll(body.data.renderId);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      startingRef.current = false;
      if (mounted.current) setStarting(false);
    }
  };

  return (
    <section aria-label="Render video" className="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Render video</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Joins every shot&apos;s chosen picture or clip with the song ({mmss(windowSec)}). Pictures get a slow zoom.
      </p>
      {shots.length > 0 && missing > 0 && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          {`${missing} of ${shots.length} ${shots.length === 1 ? 'shot needs' : 'shots need'} a picture or clip chosen.`}
        </p>
      )}
      {shots.length > 0 && total !== windowSec && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          {`The shots add up to ${mmss(total)} of the song's ${mmss(windowSec)}.`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void start()}
          disabled={!ready || starting || inFlight}
          className="min-h-11 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 lg:min-h-0"
        >
          {inFlight ? 'Rendering…' : starting ? 'Starting…' : 'Render video'}
        </button>
        {ready && !inFlight && <span className="text-sm text-gray-600 dark:text-gray-400">{`Takes ${minutes(estimate)}.`}</span>}
        {inFlight && current && (
          <span role="status" className="text-sm text-gray-600 dark:text-gray-400">
            {`Rendering — ${minutes(current.estimateSec)}. You can keep working.`}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {current?.status === 'failed' && !error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {current.error || 'The render failed. Please try again.'}
        </p>
      )}
      {current?.status === 'done' && current.s3Key ? (
        <FinishedVideo s3Key={current.s3Key} />
      ) : (
        lastDone?.s3Key && (
          <div className="space-y-1 border-t border-gray-200 pt-2 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400">Last finished video:</p>
            <FinishedVideo s3Key={lastDone.s3Key} />
          </div>
        )
      )}
    </section>
  );
}

function FinishedVideo({ s3Key }: { s3Key: string }) {
  const url = usePlayUrl(s3Key);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const download = async () => {
    setDownloadError(null);
    try {
      const res = await adminFetch(`/api/admin/mastering/download?key=${encodeURIComponent(s3Key)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success || !body.url) throw new Error();
      window.location.assign(body.url as string);
    } catch {
      setDownloadError('Could not download the video. Please try again.');
    }
  };
  return (
    <div className="space-y-2">
      {url ? (
        <video src={url} controls playsInline aria-label="Finished video" className="max-h-96 w-full rounded bg-black object-contain" />
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-400">Loading the video…</p>
      )}
      <button
        type="button"
        onClick={() => void download()}
        className="min-h-11 rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300 lg:min-h-0"
      >
        Download video
      </button>
      {downloadError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {downloadError}
        </p>
      )}
    </div>
  );
}
