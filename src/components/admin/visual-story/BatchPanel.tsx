'use client';

/**
 * "Every shot" panel: one button makes a picture for every shot that has
 * none, the other a video clip for every shot that has no clip. Each shows the
 * total on the button and confirms with the story total first.
 *
 * It drives the same per-shot routes as the shot cards, one shot at a time, so
 * the server's reservations, budget cap and settles are unchanged. A clip
 * starts from the shot's chosen picture: a chosen STILL that is not yet the
 * first frame is pinned first, and a shot with no picture is left out. A 402 stops the run; a 429 waits and retries;
 * any other failure is named and the run goes on. Stop finishes the current
 * shot and starts no more (it is checked after every wait); once every clip is
 * started there is nothing left to stop, so Stop is hidden while they render. Started clips are followed here to the end, since
 * their shot cards are only mounted for the scene on screen. Errors render here.
 */

import { useEffect, useRef, useState } from 'react';
import { delay } from '@/lib/poll-job';
import { followClips, postWithRetry, shotLabel as label, STOPPED, type Started } from '@/lib/visual-story-runner';
import { estimateCostUsd } from '@/services/video/cost';
import { OWN_CLIP_PROMPT } from '@/types/visualStory';
import type { Candidate, GenJob, Shot, VisualStory } from '@/types/visualStory';
import { RaiseBudgetButton, shotKey, usd } from './ui-utils';

/** Gap between paid requests, within the 20-a-minute route limit. */
const START_GAP_MS = 3000;
const CLIP_MAYBE_STARTED = 'The connection dropped; the clip may have started. Open the scene to check.';

type Kind = 'pictures' | 'videos';

const inflight = (j: GenJob) => j.status === 'submitted' || j.status === 'running';
const plural = (n: number) => `${n} shot${n === 1 ? '' : 's'}`;
const of = (s: Pick<Shot, 'sceneOrder' | 'shotOrder'>) => (c: Pick<Candidate, 'sceneOrder' | 'shotOrder'>) =>
  c.sceneOrder === s.sceneOrder && c.shotOrder === s.shotOrder;

/** Shots with no still picture yet. A row holding the admin's own clip needs none. */
export function shotsNeedingPicture(shots: Shot[], candidates: Candidate[]): Shot[] {
  return shots.filter((s) => s.visualPrompt !== OWN_CLIP_PROMPT && !candidates.some((c) => of(s)(c) && c.mode === 'STILL'));
}

/** Shots with no clip yet and none rendering (picture or not). */
function shotsWithoutClip(shots: Shot[], candidates: Candidate[], genJobs: GenJob[]): Shot[] {
  return shots.filter((s) => !candidates.some((c) => of(s)(c) && c.mode !== 'STILL') && !genJobs.some((j) => of(s)(j) && inflight(j)));
}

/** A first frame is pinned, or the chosen picture is a still that can be. */
const hasStartPicture = (s: Shot, candidates: Candidate[]) => !!s.firstFrameCandidateId || firstFrameToPin(s, candidates) !== null;

const inOrder = (shots: Shot[]) => [...shots].sort((a, b) => a.sceneOrder - b.sceneOrder || a.shotOrder - b.shotOrder);
const moving = (s: Shot) => s.mode !== 'STILL';

/**
 * Moving shots that continue from the clip before them (both moving, chain
 * ticked). Their clip starts from that clip's last frame, so "Make the video"
 * under Your pictures makes them one after another; a batch would make them
 * from their own picture and they would be paid for twice (audit 2026-11-09).
 */
export function chainedShots(shots: Shot[]): Shot[] {
  const list = inOrder(shots);
  return list.filter((s, i) => moving(s) && !!s.chainFromPrevious && i > 0 && moving(list[i - 1]));
}

/**
 * Shots a clip can be made for now: set to Moving, not chained, no clip, a
 * picture to start from, and a prompt (the route refuses an empty one). A
 * shot set to Still stays a picture — the batch never pays to animate it.
 */
export function shotsNeedingVideo(shots: Shot[], candidates: Candidate[], genJobs: GenJob[]): Shot[] {
  const chained = new Set(chainedShots(shots));
  return shotsWithoutClip(shots, candidates, genJobs).filter(
    (s) => moving(s) && !chained.has(s) && s.visualPrompt.trim() && hasStartPicture(s, candidates)
  );
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

export function BatchPanel({ vsId, story, shots, candidates, genJobs, onChanged }: Props) {
  const [confirming, setConfirming] = useState<Kind | null>(null);
  const [running, setRunning] = useState<Kind | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [overBudget, setOverBudget] = useState(false);
  // Clips are started and now rendering on Grok: Stop has nothing left to stop.
  const [rendering, setRendering] = useState(false);
  const stop = useRef(false);
  const mounted = useRef(true);
  const abort = useRef<AbortController>(new AbortController());
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    mounted.current = true;
    // Made here, so a StrictMode remount in dev does not keep an aborted one (every wait would be skipped).
    const ctrl = new AbortController();
    abort.current = ctrl;
    return () => {
      mounted.current = false;
      ctrl.abort();
    };
  }, []);

  const pictureShots = shotsNeedingPicture(shots, candidates);
  const videoShots = shotsNeedingVideo(shots, candidates, genJobs);
  const withoutClip = shotsWithoutClip(shots, candidates, genJobs);
  const needPictureFirst = withoutClip.filter((s) => moving(s) && !hasStartPicture(s, candidates)).length;
  const stillCount = withoutClip.filter((s) => !moving(s)).length;
  const chainedCount = chainedShots(shots).filter((s) => withoutClip.includes(s)).length;
  const priceOf = (kind: Kind, list: Shot[]) =>
    list.reduce((n, s) => n + estimateCostUsd('grok', kind === 'pictures' ? 'STILL' : 'HERO', s.durationSec), 0);
  const picturePrice = priceOf('pictures', pictureShots);
  const videoPrice = priceOf('videos', videoShots);

  const ctl = { signal: abort.current.signal, isMounted: () => mounted.current, isStopped: () => stop.current };
  const post = (url: string, body?: unknown) => postWithRetry(url, body, { ...ctl, signal: abort.current.signal });

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
    const started: Started[] = [];
    let made = 0;
    let tried = 0;
    let refused = false;
    try {
      for (const s of list) {
        if (stop.current || !mounted.current) break;
        if (tried > 0) await delay(START_GAP_MS, abort.current.signal);
        if (stop.current || !mounted.current) break;
        tried++;
        const base = `/api/admin/visual-story/${vsId}/shots`;
        setProgress(kind === 'pictures' ? `Picture ${tried} of ${list.length}…` : `Starting clip ${tried} of ${list.length}…`);
        if (kind === 'videos') {
          const pin = firstFrameToPin(s, candidates);
          if (pin) {
            const r = await post(base, { op: 'update', sceneOrder: s.sceneOrder, shotOrder: s.shotOrder, firstFrameCandidateId: pin });
            if (!r.ok && r.status === STOPPED) break;
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
        if (r.status === STOPPED) break;
        if (r.status === 402 || r.status === 401 || r.status === 403) {
          setError(r.error);
          setOverBudget(r.status === 402);
          refused = true;
          break;
        }
        // 9: a video POST that never answered may still have been accepted (and charged).
        failed.push(`${label(s)}: ${kind === 'videos' && r.status === 0 ? CLIP_MAYBE_STARTED : r.error}`);
      }
      if (kind === 'videos' && started.length) {
        changed.current();
        setRendering(true);
        const r = await followClips(vsId, started, {
          ...ctl,
          signal: abort.current.signal,
          onProgress: (done, total) => setProgress(`Rendering: ${done} of ${total} clips finished…`),
        });
        made = r.succeeded.length;
        failed.push(...r.failed.map((f) => `${label(f.shot)}: ${f.error}`));
        if (r.open && mounted.current) failed.push(`${r.open} still rendering — open their scenes in a few minutes to see them.`);
      }
    } finally {
      if (mounted.current) {
        const noun = kind === 'pictures' ? 'pictures' : 'clips';
        setSummary(`${stop.current || refused ? 'Stopped' : 'Done'}: ${made} of ${list.length} ${noun} made.`);
        setFailures(failed);
        setProgress(null);
        setRunning(null);
        setRendering(false);
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
      {needPictureFirst > 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400">{needPictureFirst === 1 ? '1 shot needs a picture before its clip.' : `${needPictureFirst} shots need a picture before their clips.`}</p>
      )}
      {stillCount > 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {stillCount === 1 ? '1 shot is set to Still and stays a picture' : `${stillCount} shots are set to Still and stay pictures`}
          {' — set a row to Moving under Your pictures to animate it.'}
        </p>
      )}
      {chainedCount > 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {chainedCount === 1 ? '1 shot continues from the clip before it' : `${chainedCount} shots continue from the clip before them`}
          {' — Make the video under Your pictures makes those in order.'}
        </p>
      )}
      {confirming && !running && confirmBox(confirming)}
      {running && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <span>{progress}</span>
          {rendering ? (
            <span className="text-gray-600 dark:text-gray-400">The clips keep rendering even if you leave this page.</span>
          ) : (
            <button type="button" onClick={() => (stop.current = true)} className="text-blue-700 hover:underline dark:text-blue-400">
              Stop
            </button>
          )}
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
