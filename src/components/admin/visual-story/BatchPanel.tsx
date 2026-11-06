'use client';

/**
 * "Every shot" panel: one button makes a picture for every shot that has
 * none, the other a video clip for every shot that has no clip. Each shows the
 * total on the button and confirms with the story total first.
 *
 * It drives the same per-shot routes as the shot cards, one shot at a time, so
 * the server's reservations, budget cap and settles are unchanged. A clip
 * starts from the shot's chosen picture: a chosen STILL that is not yet the
 * first frame is pinned first. A 402 stops the run; a 429 waits and retries;
 * any other failure is named and the run goes on. Stop finishes the current
 * shot and starts no more. Started clips are followed here to the end, since
 * their shot cards are only mounted for the scene on screen. Errors render here.
 */

import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { delay } from '@/lib/poll-job';
import { estimateCostUsd } from '@/services/video/cost';
import type { Candidate, GenJob, Shot, VisualStory } from '@/types/visualStory';
import { RaiseBudgetButton, shotKey, usd } from './ui-utils';

/** Gap between paid requests, and the wait after a 429, both within the 20-a-minute route limit. */
const START_GAP_MS = 3000;
const RATE_LIMIT_WAIT_MS = 30_000;
const RATE_LIMIT_TRIES = 3;
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 20 * 60_000;
const OFFLINE = 'Could not reach the server.';

type Kind = 'pictures' | 'videos';

const inflight = (j: GenJob) => j.status === 'submitted' || j.status === 'running';
const label = (s: Pick<Shot, 'sceneOrder' | 'shotOrder'>) => `Scene ${s.sceneOrder}, shot ${s.shotOrder}`;
const plural = (n: number) => `${n} shot${n === 1 ? '' : 's'}`;
const of = (s: Pick<Shot, 'sceneOrder' | 'shotOrder'>) => (c: Pick<Candidate, 'sceneOrder' | 'shotOrder'>) =>
  c.sceneOrder === s.sceneOrder && c.shotOrder === s.shotOrder;

/** Shots with no still picture yet. */
export function shotsNeedingPicture(shots: Shot[], candidates: Candidate[]): Shot[] {
  return shots.filter((s) => !candidates.some((c) => of(s)(c) && c.mode === 'STILL'));
}

/** Shots with no clip yet and none rendering. */
export function shotsNeedingVideo(shots: Shot[], candidates: Candidate[], genJobs: GenJob[]): Shot[] {
  return shots.filter((s) => !candidates.some((c) => of(s)(c) && c.mode !== 'STILL') && !genJobs.some((j) => of(s)(j) && inflight(j)));
}

/** The chosen picture to pin as the clip's first frame, or null when none is needed. */
export function firstFrameToPin(shot: Shot, candidates: Candidate[]): string | null {
  if (shot.firstFrameCandidateId || !shot.selectedCandidateId) return null;
  const chosen = candidates.find((c) => c.candId === shot.selectedCandidateId && of(shot)(c));
  return chosen?.mode === 'STILL' ? chosen.candId : null;
}

interface Props {
  vsId: string;
  story: VisualStory;
  shots: Shot[];
  candidates: Candidate[];
  genJobs: GenJob[];
  /** Reload the tree (pictures, clips, spend). */
  onChanged: () => void;
}

type Outcome = { ok: true; data?: { jobId?: string } } | { ok: false; status: number; error: string };

export function BatchPanel({ vsId, story, shots, candidates, genJobs, onChanged }: Props) {
  const [confirming, setConfirming] = useState<Kind | null>(null);
  const [running, setRunning] = useState<Kind | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [overBudget, setOverBudget] = useState(false);
  const stop = useRef(false);
  const mounted = useRef(true);
  const abort = useRef(new AbortController());
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    mounted.current = true;
    const ctrl = abort.current;
    return () => {
      mounted.current = false;
      ctrl.abort();
    };
  }, []);

  const pictureShots = shotsNeedingPicture(shots, candidates);
  const videoShots = shotsNeedingVideo(shots, candidates, genJobs);
  const priceOf = (kind: Kind, list: Shot[]) =>
    list.reduce((n, s) => n + estimateCostUsd('grok', kind === 'pictures' ? 'STILL' : 'HERO', s.durationSec), 0);
  const picturePrice = priceOf('pictures', pictureShots);
  const videoPrice = priceOf('videos', videoShots);

  /** One paid POST, retried after a 429. No signal: a paid call is never cut short. */
  const post = async (url: string, body?: unknown): Promise<Outcome> => {
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await adminFetch(url, {
          method: 'POST',
          ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
        });
      } catch {
        return { ok: false, status: 0, error: OFFLINE };
      }
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) return { ok: true, data: json.data };
      if (res.status === 429 && attempt < RATE_LIMIT_TRIES) {
        await delay(RATE_LIMIT_WAIT_MS, abort.current.signal);
        if (!mounted.current) return { ok: false, status: 0, error: OFFLINE };
        continue;
      }
      return { ok: false, status: res.status, error: json?.error || `HTTP ${res.status}` };
    }
  };

  /** Follow started clips until each ends (or the cap); returns how many succeeded. */
  const follow = async (jobs: { jobId: string; shot: Shot }[], failed: string[]): Promise<number> => {
    let open = [...jobs];
    let made = 0;
    const until = Date.now() + POLL_TIMEOUT_MS;
    while (open.length && mounted.current && Date.now() < until) {
      const still: typeof open = [];
      for (const j of open) {
        let job: GenJob | undefined;
        try {
          const res = await adminFetch(`/api/admin/visual-story/${vsId}/video-jobs/${j.jobId}`, { signal: abort.current.signal });
          const json = await res.json().catch(() => null);
          job = res.ok && json?.success ? (json.data as GenJob) : undefined;
        } catch {
          job = undefined; // transient: look again next round
        }
        if (job?.status === 'succeeded') made++;
        else if (job?.status === 'failed' || job?.status === 'cancelled') failed.push(`${label(j.shot)}: ${job.error || 'The video failed.'}`);
        else still.push(j);
      }
      open = still;
      setProgress(`Rendering: ${jobs.length - open.length} of ${jobs.length} clips finished…`);
      if (open.length) await delay(POLL_INTERVAL_MS, abort.current.signal);
    }
    if (open.length && mounted.current) failed.push(`${open.length} still rendering — open their scenes in a few minutes to see them.`);
    return made;
  };

  const run = async (kind: Kind) => {
    const list = kind === 'pictures' ? pictureShots : videoShots;
    setConfirming(null);
    setRunning(kind);
    setSummary(null);
    setError(null);
    setOverBudget(false);
    setFailures([]);
    stop.current = false;
    const failed: string[] = [];
    const started: { jobId: string; shot: Shot }[] = [];
    let made = 0;
    let tried = 0;
    try {
      for (const s of list) {
        if (stop.current || !mounted.current) break;
        if (tried > 0) await delay(START_GAP_MS, abort.current.signal);
        tried++;
        const base = `/api/admin/visual-story/${vsId}/shots`;
        setProgress(kind === 'pictures' ? `Picture ${tried} of ${list.length}…` : `Starting clip ${tried} of ${list.length}…`);
        if (kind === 'videos') {
          const pin = firstFrameToPin(s, candidates);
          if (pin) {
            const r = await post(base, { op: 'update', sceneOrder: s.sceneOrder, shotOrder: s.shotOrder, firstFrameCandidateId: pin });
            if (!r.ok) {
              failed.push(`${label(s)}: ${r.error}`);
              continue;
            }
          }
        }
        const r = await post(`${base}/${shotKey(s)}/${kind === 'pictures' ? 'still' : 'video'}`);
        if (r.ok) {
          if (kind === 'pictures') {
            made++;
            changed.current();
          } else if (r.data?.jobId) started.push({ jobId: String(r.data.jobId), shot: s });
          continue;
        }
        if (r.status === 402 || r.status === 401 || r.status === 403) {
          setError(r.error);
          setOverBudget(r.status === 402);
          break;
        }
        failed.push(`${label(s)}: ${r.error}`);
      }
      if (kind === 'videos' && started.length) {
        changed.current();
        made = await follow(started, failed);
      }
    } finally {
      if (mounted.current) {
        const noun = kind === 'pictures' ? 'pictures' : 'clips';
        setSummary(`${stop.current ? 'Stopped' : 'Done'}: ${made} of ${list.length} ${noun} made.`);
        setFailures(failed);
        setProgress(null);
        setRunning(null);
        changed.current();
      }
    }
  };

  const confirmBox = (kind: Kind) => {
    const n = kind === 'pictures' ? pictureShots.length : videoShots.length;
    const price = kind === 'pictures' ? picturePrice : videoPrice;
    const after = story.spentUsd + story.reservedUsd + price;
    const overCap = after > story.budgetUsdCap + 1e-9;
    return (
      <div role="dialog" aria-label="Confirm every shot" className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="text-gray-800 dark:text-gray-200">
          {kind === 'pictures'
            ? `Make one picture for each of ${plural(n)} for ${usd(price)}?`
            : `Make a video clip for each of ${plural(n)} for ${usd(price)}?`}
        </p>
        {kind === 'videos' && (
          <p className="text-gray-600 dark:text-gray-400">
            Each clip starts from the shot&apos;s chosen picture. You see them only after they are all made, so try one or two shots by hand first.
          </p>
        )}
        <p className="text-gray-600 dark:text-gray-400">{`Story total after this: ${usd(after)} of ${usd(story.budgetUsdCap)}`}</p>
        {overCap && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-red-600 dark:text-red-400">That is over this story&apos;s budget cap.</p>
            <RaiseBudgetButton />
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => void run(kind)} disabled={overCap} className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
            Confirm
          </button>
          <button type="button" onClick={() => setConfirming(null)} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const button = (kind: Kind, n: number, price: number, text: string) => (
    <button
      type="button"
      disabled={!!running || n === 0}
      onClick={() => setConfirming(kind)}
      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200"
    >
      {`${text} (${plural(n)} · ${usd(price)})`}
    </button>
  );

  return (
    <section aria-label="Every shot" className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Every shot</h2>
      <div className="flex flex-wrap gap-2">
        {button('pictures', pictureShots.length, picturePrice, 'Pictures for every shot')}
        {button('videos', videoShots.length, videoPrice, 'Videos for every shot')}
      </div>
      {pictureShots.length === 0 && <p className="text-sm text-gray-600 dark:text-gray-400">Every shot has a picture.</p>}
      {confirming && !running && confirmBox(confirming)}
      {running && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <span>{progress}</span>
          <button type="button" onClick={() => (stop.current = true)} className="text-blue-700 hover:underline dark:text-blue-400">
            Stop
          </button>
        </p>
      )}
      {error && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
          {overBudget && <RaiseBudgetButton />}
        </div>
      )}
      {summary && (
        <p role="status" className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {summary}
        </p>
      )}
      {failures.length > 0 && (
        <ul aria-label="Shots that failed" className="list-disc pl-5 text-sm text-red-600 dark:text-red-400">
          {failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
