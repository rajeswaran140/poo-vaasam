'use client';

/**
 * Draft panel (spec §6.5, §10): paste lyrics → Claude proposes scenes and shots
 * → preview with the total against the window → Apply. Apply REPLACES the
 * current storyboard, so it asks first.
 *
 * A draft takes about a minute (up to ~7 for a whole song), so it runs on the background worker (R14):
 * POST starts a job (202 { jobId }), the panel polls the job route with
 * pollJob() until done/failed (cap 12 minutes), then reloads the tree — the new
 * draft and the spend come from the server. The button stays disabled while a
 * job is pending.
 *
 * A draft is paid for, so the newest persisted one (tree.drafts) is shown on
 * load as "Last draft (<date>)" — the model has no applied marker, so it is
 * labelled by date, not as pending. The lyrics are sent once and never kept
 * here after the request. Errors render inside this panel.
 */

import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { pollJob } from '@/lib/poll-job';
import { draftLabelUsd } from '@/services/video/cost';
import type { StoryboardDraft } from '@/types/visualStory';
import { usd } from './ui-utils';

interface Props {
  vsId: string;
  windowSec: number;
  sceneCount: number;
  shotCount: number;
  /** The newest persisted draft, if any. */
  lastDraft: StoryboardDraft | null;
  /** A draft job still being made (from the tree): followed on load, never paid for again. */
  liveJobId?: string | null;
  /** Reload the tree (spend) after a draft request settles. */
  onChanged: () => void;
  /** The apply route returns the whole new tree. */
  onApplied: (tree: unknown) => void;
}

const POLL_INTERVAL_MS = 3000;
/** A seven-minute window's draft can take ~7 minutes on the worker; wait past that. */
const POLL_TIMEOUT_MS = 12 * 60_000;
const POLL_TIMEOUT_MESSAGE = 'The draft is taking longer than expected. Reload the page in a few minutes to see it.';

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
};

export function DraftPanel({ vsId, windowSec, sceneCount, shotCount, lastDraft, liveJobId = null, onChanged, onApplied }: Props) {
  const [lyrics, setLyrics] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  // The draft this session's job produced; it arrives through the tree reload.
  const [freshId, setFreshId] = useState<string | null>(null);
  const mounted = useRef(true);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  // A draft applied in this session is not offered again until a reload.
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const applyInFlight = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = lastDraft && lastDraft.draftId !== appliedId ? lastDraft : null;
  const isFresh = !!draft && draft.draftId === freshId;

  /**
   * Start a draft (lyrics) or follow one already being made (jobId): either
   * way the panel waits for it and reloads the tree when it ends.
   */
  const run = async (start: { lyrics: string } | { jobId: string }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setConfirming(false);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      let jobId: string;
      if ('jobId' in start) {
        jobId = start.jobId;
      } else {
        const res = await adminFetch(`/api/admin/visual-story/${vsId}/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lyrics: start.lyrics }),
        });
        const body = await res.json().catch(() => null);
        // 409 with a jobId: one is already running (another tab, or before a reload) — follow it.
        if (res.status === 409 && body?.data?.jobId) {
          jobId = String(body.data.jobId);
        } else if (!res.ok || !body?.success || !body?.data?.jobId) {
          setError(body?.error || `Could not draft the storyboard (HTTP ${res.status}).`);
          return;
        } else {
          jobId = String(body.data.jobId);
        }
      }
      const result = await pollJob<{ draftId: string }>({
        fetchStatus: (signal) => adminFetch(`/api/admin/visual-story/${vsId}/draft/jobs/${jobId}`, { signal }),
        signal: ctrl.signal,
        isMounted: () => mounted.current,
        intervalMs: POLL_INTERVAL_MS,
        timeoutMs: POLL_TIMEOUT_MS,
        timeoutMessage: POLL_TIMEOUT_MESSAGE,
      });
      if (result?.draftId && mounted.current) setFreshId(result.draftId);
    } catch (err) {
      if (!mounted.current) return;
      const message = err instanceof Error ? err.message : '';
      setError(
        message && !/fetch|network/i.test(message)
          ? message
          : 'Could not reach the server. Check your connection and try again.'
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setPending(false);
        onChanged(); // the new draft and the settled spend come from the server
      }
    }
  };

  const requestDraft = () => {
    if (lyrics.trim()) void run({ lyrics });
  };

  // A draft still being made when the page loaded (reload, another tab): follow it.
  useEffect(() => {
    if (liveJobId) void run({ jobId: liveJobId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveJobId]);

  const apply = async () => {
    if (!draft || applyInFlight.current) return;
    applyInFlight.current = true;
    setApplying(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/draft/${draft.draftId}/apply`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error || 'Could not apply the draft.');
        return;
      }
      setFreshId(null);
      setAppliedId(draft.draftId);
      setConfirming(false);
      onApplied(body.data);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      applyInFlight.current = false;
      setApplying(false);
    }
  };

  const draftSec = draft ? draft.scenes.reduce((t, s) => t + s.shots.reduce((u, sh) => u + sh.durationSec, 0), 0) : 0;
  const empty = sceneCount === 0 && shotCount === 0;

  return (
    <section aria-label="Storyboard draft" className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Draft from lyrics</h2>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        Lyrics
        <textarea
          rows={6}
          maxLength={8000}
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
        />
      </label>
      <button
        type="button"
        disabled={pending || !lyrics.trim()}
        onClick={requestDraft}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Drafting…' : `Draft storyboard (≈${usd(draftLabelUsd(lyrics, windowSec))})`}
      </button>
      {pending && (
        <p role="status" className="text-sm text-gray-700 dark:text-gray-300">
          A draft is being made — about a minute, up to about 7 minutes for a whole song. It shows here when it is ready.
        </p>
      )}
      {!pending && (
        <p className="text-xs text-gray-600 dark:text-gray-400">About a minute for a short part, up to about 7 minutes for a whole song.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {draft && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{isFresh ? 'New draft' : `Last draft (${when(draft.createdAt)})`}</h3>
          <p className={`text-sm font-medium ${draftSec === windowSec ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
            {`Draft fills ${draftSec} of ${windowSec} s`}
          </p>
          <ol className="space-y-2">
            {draft.scenes.map((scene, si) => (
              <li key={si} className="rounded-md border border-gray-200 p-2 dark:border-gray-700">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{scene.heading}</p>
                {scene.summary && <p className="text-xs text-gray-600 dark:text-gray-400">{scene.summary}</p>}
                <ol className="mt-1 space-y-1">
                  {scene.shots.map((sh, hi) => (
                    <li key={hi} className="text-xs text-gray-700 dark:text-gray-300">
                      <span className="font-medium">{`${sh.durationSec} s · ${sh.mode}`}</span>
                      {sh.characterNames.length > 0 && <span>{` · ${sh.characterNames.join(', ')}`}</span>}
                      <span className="block text-gray-800 dark:text-gray-200">{sh.visualPrompt}</span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>

          {!confirming ? (
            <button
              type="button"
              disabled={applying}
              onClick={() => (empty ? void apply() : setConfirming(true))}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Apply
            </button>
          ) : (
            <div role="alertdialog" aria-label="Replace the storyboard?" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
              <p className="text-sm text-amber-900 dark:text-amber-200">
                {`Applying replaces the current storyboard: its ${sceneCount} scene${sceneCount === 1 ? '' : 's'}, ${shotCount} shot${shotCount === 1 ? '' : 's'} and their generated images are removed. Characters are kept.`}
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={applying} onClick={apply} className="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
                  {applying ? 'Replacing…' : 'Replace storyboard'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
