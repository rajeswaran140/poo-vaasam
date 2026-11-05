'use client';

/**
 * A shot card's video controls: "Make video (6 s · $0.48)" behind a
 * confirm-before-spend dialog with the story total, then the job's progress.
 *
 * The make-video route answers 202 { jobId }; the clip renders on Grok for a
 * minute or three, so this polls the job route with pollJob() every 5 s (cap
 * 15 minutes) and reloads the tree when it ends. A submitted|running job found
 * in the loaded tree (a page reload, another tab) resumes polling. The button
 * stays disabled while any job for this shot is in flight — the ref closes the
 * gap between two fast clicks, the state and the tree cover the rest.
 *
 * Polling treats a network failure or a 5xx as transient and keeps going
 * within the cap; a 4xx or the cap stops it, and "Check again" restarts it.
 *
 * Cancel asks first: Grok may already have accepted the clip, so the server
 * always records it as spent (Ruling V6). Neither paid POST carries the poll's
 * abort signal. Every error renders here, inside the card.
 */

import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { pollJob } from '@/lib/poll-job';
import { estimateCostUsd } from '@/services/video/cost';
import type { GenJob, VisualStory } from '@/types/visualStory';
import { usd } from './ui-utils';

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 15 * 60_000;
const POLL_TIMEOUT_MESSAGE = 'Still rendering. Use “Check rendering videos” on the story list.';
const OFFLINE = 'Could not reach the server. Check your connection and try again.';

const inflight = (j: GenJob) => j.status === 'submitted' || j.status === 'running';

/** pollJob error codes: the job itself failed (terminal) vs this page stopped checking. */
const JOB_FAILED = 'job_failed';
const POLL_STOPPED = 'poll_stopped';

const fake = (mapped: unknown) => ({ ok: true, status: 200, json: async () => mapped }) as Response;
const RUNNING = { status: 'running' };

/** Why a 4xx poll stops, by status — never by matching the message text. */
function stopMessage(status: number, serverError: unknown): string {
  if (status === 401 || status === 403) return 'Your sign-in has expired. Sign in again, then check again.';
  if (typeof serverError === 'string' && serverError) return serverError;
  if (status === 404) return 'That video no longer exists.';
  return `Could not check the video (HTTP ${status}).`;
}

/**
 * Fetch the job once and translate the route's `{ success, data: GenJob }`
 * (Ruling V2) into pollJob's `{ status: 'done' | 'error' | 'running' }`.
 * A network rejection or a 5xx (e.g. a gateway timeout while the server copies
 * the finished clip) is transient: report "running" and try again next tick,
 * within the 15-minute cap. A 4xx stops polling with a message.
 */
async function fetchJobStatus(url: string, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await adminFetch(url, { signal });
  } catch {
    return fake(RUNNING);
  }
  if (res.status >= 500) return fake(RUNNING);
  const body = await res.json().catch(() => null);
  if (!res.ok) return fake({ status: 'error', error: { code: POLL_STOPPED, message: stopMessage(res.status, body?.error) } });
  const job = body?.success ? (body.data as GenJob | undefined) : undefined;
  if (!job) return fake({ status: 'error', error: { code: POLL_STOPPED, message: 'Could not check the video.' } });
  if (job.status === 'succeeded' || job.status === 'cancelled') return fake({ status: 'done', result: job });
  if (job.status === 'failed') return fake({ status: 'error', error: { code: JOB_FAILED, message: job.error || 'The video failed.' } });
  return fake(RUNNING);
}

interface Props {
  vsId: string;
  shotKey: string;
  label: string;
  durationSec: number;
  story: VisualStory;
  /** This shot's video jobs from the tree. */
  jobs: GenJob[];
  onChanged: () => void;
}

export function VideoControls({ vsId, shotKey, label, durationSec, story, jobs, onChanged }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  // The job this card is polling (or gave up polling after the cap).
  const [jobId, setJobId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Polling stopped before the job ended (a 4xx, the cap): offer "Check again".
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const inFlight = useRef(false);
  // Every job id this mount has polled, so a reload that still lists it doesn't start a second poller.
  const polled = useRef(new Set<string>());
  const mounted = useRef(true);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const price = estimateCostUsd('grok', 'HERO', durationSec);
  const after = story.spentUsd + story.reservedUsd + price;
  const overCap = after > story.budgetUsdCap + 1e-9;
  const running = jobs.find(inflight) ?? null;
  const busy = starting || polling || !!running;
  // The newest job's failure stays visible after a reload (e.g. one the list page's reconcile ended).
  const newest = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const lastFailure = !busy && newest?.status === 'failed' ? `Last clip failed: ${newest.error || 'no reason given.'}` : null;
  const shownError = error ?? lastFailure;

  const poll = async (id: string) => {
    if (polled.current.has(id)) return;
    polled.current.add(id);
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setJobId(id);
    setPolling(true);
    setNote(null);
    setStopped(false);
    try {
      await pollJob<GenJob>({
        fetchStatus: (signal) => fetchJobStatus(`/api/admin/visual-story/${vsId}/video-jobs/${id}`, signal),
        signal: ctrl.signal,
        isMounted: () => mounted.current,
        intervalMs: POLL_INTERVAL_MS,
        timeoutMs: POLL_TIMEOUT_MS,
        timeoutMessage: POLL_TIMEOUT_MESSAGE,
      });
    } catch (err) {
      if (!mounted.current || ctrl.signal.aborted) return;
      const message = err instanceof Error ? err.message : '';
      const code = (err as { code?: string } | null)?.code;
      if (code === JOB_FAILED) setError(message);
      else {
        // Not terminal: the job may still be rendering. Let the user look again.
        setStopped(true);
        if (message === POLL_TIMEOUT_MESSAGE) setNote(message);
        else setError(code === POLL_STOPPED && message ? message : 'Could not check the video.');
      }
    } finally {
      if (mounted.current && abort.current === ctrl) {
        setPolling(false);
        onChanged(); // the candidate and the settled spend come from the server
      }
    }
  };

  // Resume a job the tree says is still rendering.
  useEffect(() => {
    if (running && !polled.current.has(running.jobId)) void poll(running.jobId);
    // poll is re-created each render; the guard set makes this idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running?.jobId]);

  const checkAgain = () => {
    const id = running?.jobId ?? jobId;
    if (!id || polling) return;
    polled.current.delete(id);
    setError(null);
    void poll(id);
  };

  const start = async () => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setConfirming(false);
    setStarting(true);
    setError(null);
    setNote(null);
    setStopped(false);
    let id: string | null = null;
    try {
      // No signal: a paid call is never cut short by the client.
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/shots/${shotKey}/video`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success || !body?.data?.jobId) setError(body?.error || `Could not start the video (HTTP ${res.status}).`);
      else id = String(body.data.jobId);
    } catch {
      setError(OFFLINE);
    } finally {
      inFlight.current = false;
      if (mounted.current) setStarting(false);
    }
    if (!mounted.current) return;
    if (id) {
      onChanged(); // the reservation moved
      await poll(id);
    } else {
      onChanged(); // a refusal may still have moved spend
    }
  };

  const cancel = async () => {
    const id = running?.jobId ?? jobId;
    if (!id || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/video-jobs/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'cancel' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) setError(body?.error || 'Could not cancel the video.');
      else {
        setConfirmingCancel(false);
        abort.current?.abort();
        setPolling(false);
        setNote(null);
        setStopped(false);
      }
    } catch {
      setError(OFFLINE);
    } finally {
      if (mounted.current) {
        setCancelling(false);
        onChanged();
      }
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => !busy && setConfirming(true)}
        className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Rendering…' : `Make video (${durationSec} s · ${usd(price)})`}
      </button>
      {confirming && !busy && (
        <div role="dialog" aria-label={`Confirm video for ${label}`} className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-gray-800 dark:text-gray-200">{`Make one ${durationSec}-second video clip for ${usd(price)}?`}</p>
          <p className="text-gray-600 dark:text-gray-400">{`Story total after this: ${usd(after)} of ${usd(story.budgetUsdCap)}`}</p>
          {overCap && <p className="text-red-600 dark:text-red-400">That is over this story&apos;s budget cap.</p>}
          <div className="flex gap-2">
            <button type="button" onClick={start} disabled={overCap} className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
              Confirm
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}
      {(polling || running || note) && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <span>{note ?? 'Rendering… about 1–3 minutes'}</span>
          {(polling || running) && !confirmingCancel && (
            <button type="button" onClick={() => setConfirmingCancel(true)} className="text-blue-700 hover:underline dark:text-blue-400">
              Cancel
            </button>
          )}
        </p>
      )}
      {confirmingCancel && (polling || running) && (
        <div role="alertdialog" aria-label={`Cancel the video for ${label}?`} className="space-y-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm dark:border-red-700 dark:bg-red-950">
          <p className="text-red-900 dark:text-red-200">Grok may still charge for this clip.</p>
          <div className="flex gap-2">
            <button type="button" disabled={cancelling} onClick={cancel} className="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
              {cancelling ? 'Cancelling…' : 'Cancel video'}
            </button>
            <button type="button" onClick={() => setConfirmingCancel(false)} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
              Keep rendering
            </button>
          </div>
        </div>
      )}
      {stopped && !polling && (running || jobId) && (
        <button type="button" onClick={checkAgain} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
          Check again
        </button>
      )}
      {shownError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {shownError}
        </p>
      )}
    </div>
  );
}
