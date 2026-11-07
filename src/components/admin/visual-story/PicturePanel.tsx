'use client';

/**
 * "Video from your pictures": upload several pictures at once (each becomes a
 * shot, in order), set each one's seconds and Moving / Still, then one button
 * makes the whole video — Grok animates each moving picture starting from it,
 * each clip is chosen for its shot, a still picture is chosen back for a still
 * shot (the render gives it a slow zoom), and the story is rendered.
 *
 * Moving = shot mode HERO, Still = STILL; nothing else is stored. A moving
 * picture that already has a clip is not paid for again. Nothing renders while
 * a clip failed, a row has no picture, or the seconds do not fill the story's
 * window ("Fit to N s" scales them, 1-15 s each). Paid requests go one at a
 * time through the shot routes (visual-story-runner), so the budget cap holds.
 * Errors render here.
 */

import { useEffect, useRef, useState } from 'react';
import { putToS3 } from '@/lib/mastering-upload-client';
import { delay } from '@/lib/poll-job';
import { fitDurations, MAX_FIT_SEC, MIN_FIT_SEC } from '@/lib/visual-story-fit';
import { followClips, postWithRetry, STOPPED, type Started } from '@/lib/visual-story-runner';
import { estimateCostUsd } from '@/services/video/cost';
import { candIdForJob } from '@/types/visualStory';
import type { Candidate, GenJob, Scene, Shot, VisualStory } from '@/types/visualStory';
import { RaiseBudgetButton, shotKey, Thumb, usd } from './ui-utils';

const DEFAULT_SECONDS = 8;
/** A shot needs a prompt; for a picture it says how the picture should move. */
export const DEFAULT_MOTION = 'Gentle, natural movement. Keep the people, place and colours exactly as in the picture.';
const SCENE_HEADING = 'Your pictures';
const START_GAP_MS = 3000;

const isMoving = (s: Shot) => s.mode !== 'STILL';
const of = (s: Pick<Shot, 'sceneOrder' | 'shotOrder'>) => (c: Pick<Candidate, 'sceneOrder' | 'shotOrder'>) =>
  c.sceneOrder === s.sceneOrder && c.shotOrder === s.shotOrder;
const newest = (list: Candidate[]) => [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

interface Props {
  vsId: string;
  story: VisualStory;
  scenes: Scene[];
  shots: Shot[];
  candidates: Candidate[];
  genJobs: GenJob[];
  onChanged: () => void;
}

export function PicturePanel({ vsId, story, scenes, shots, candidates, genJobs, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [overBudget, setOverBudget] = useState(false);
  const [rendering, setRendering] = useState(false);
  const stop = useRef(false);
  const mounted = useRef(true);
  const abort = useRef<AbortController>(new AbortController());
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    mounted.current = true;
    const ctrl = new AbortController();
    abort.current = ctrl;
    return () => {
      mounted.current = false;
      ctrl.abort();
    };
  }, []);

  const ctl = () => ({ signal: abort.current.signal, isMounted: () => mounted.current, isStopped: () => stop.current });
  const post = (url: string, body?: unknown) => postWithRetry(url, body, ctl());
  const base = `/api/admin/visual-story/${vsId}`;

  const rows = [...shots].sort((a, b) => a.sceneOrder - b.sceneOrder || a.shotOrder - b.shotOrder);
  const nameOf = (s: Shot) => `Picture ${rows.indexOf(s) + 1}`;
  const windowSec = story.windowEndSec - story.windowStartSec;
  const total = rows.reduce((n, s) => n + s.durationSec, 0);
  const picOf = (s: Shot) => {
    const sel = candidates.find((c) => c.candId === s.selectedCandidateId && of(s)(c));
    return sel?.mode === 'STILL' ? sel : newest(candidates.filter((c) => of(s)(c) && c.mode === 'STILL'));
  };
  const clipOf = (s: Shot) => newest(candidates.filter((c) => of(s)(c) && c.mode !== 'STILL'));
  const rendersNow = (s: Shot) => genJobs.some((j) => of(s)(j) && (j.status === 'submitted' || j.status === 'running'));
  const toAnimate = rows.filter((s) => isMoving(s) && !clipOf(s) && !rendersNow(s));
  const price = toAnimate.reduce((n, s) => n + estimateCostUsd('grok', 'HERO', s.durationSec), 0);
  const missing = rows.filter((s) => !picOf(s));
  const fits = total === windowSec;
  const after = story.spentUsd + story.reservedUsd + price;
  const overCap = after > story.budgetUsdCap + 1e-9;
  const canMake = rows.length > 0 && fits && missing.length === 0 && !busy;

  const update = async (s: Shot, fields: Record<string, unknown>) => {
    setError(null);
    const r = await post(`${base}/shots`, { op: 'update', sceneOrder: s.sceneOrder, shotOrder: s.shotOrder, ...fields });
    if (!r.ok && r.status !== STOPPED) setError(`${nameOf(s)}: ${r.error}`);
    return r.ok;
  };

  const addPictures = async (files: File[]) => {
    if (busy || files.length === 0) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    setFailures([]);
    const failed: string[] = [];
    try {
      let sceneOrder = scenes.length ? Math.max(...scenes.map((s) => s.order)) : 0;
      if (!sceneOrder) {
        const r = await post(`${base}/scenes`, { op: 'create', heading: SCENE_HEADING, summary: '' });
        const order = r.ok ? Number((r.data?.scene as { order?: number } | undefined)?.order) : NaN;
        if (!r.ok || !order) {
          setError(r.ok ? 'Could not add the pictures.' : r.error);
          return;
        }
        sceneOrder = order;
      }
      for (const [i, file] of files.entries()) {
        if (!mounted.current) break;
        setProgress(`Adding picture ${i + 1} of ${files.length}…`);
        const made = await post(`${base}/shots`, { op: 'create', sceneOrder, mode: 'STILL', durationSec: DEFAULT_SECONDS, visualPrompt: DEFAULT_MOTION });
        const created = made.ok ? (made.data?.shot as Pick<Shot, 'sceneOrder' | 'shotOrder'> | undefined) : undefined;
        if (!created) {
          failed.push(`${file.name}: ${made.ok ? 'Could not add it.' : made.error}`);
          continue;
        }
        const url = `${base}/shots/${shotKey(created)}/upload`;
        const presign = await post(url, { op: 'presign', contentType: file.type, size: file.size });
        if (!presign.ok) {
          failed.push(`${file.name}: ${presign.error}`);
          continue;
        }
        const p = presign.data as { uploadUrl: string; fields: Record<string, string>; key: string };
        try {
          await putToS3(p.uploadUrl, p.fields, file, () => {}, abort.current.signal);
        } catch (err) {
          failed.push(`${file.name}: ${err instanceof Error ? err.message : 'The upload failed.'}`);
          continue;
        }
        const ok = await post(url, { op: 'confirm', key: p.key });
        if (!ok.ok) failed.push(`${file.name}: ${ok.error}`);
      }
    } finally {
      if (mounted.current) {
        setFailures(failed);
        setProgress(null);
        setBusy(false);
        changed.current();
      }
    }
  };

  const fit = async () => {
    const next = fitDurations(rows.map((s) => s.durationSec), windowSec);
    if (!next) {
      setError(`${rows.length} pictures cannot fill ${windowSec} s at ${MIN_FIT_SEC}-${MAX_FIT_SEC} s each. Add or remove pictures.`);
      return;
    }
    setBusy(true);
    try {
      for (const [i, s] of rows.entries()) {
        if (next[i] !== s.durationSec && !(await update(s, { durationSec: next[i] }))) break;
      }
    } finally {
      if (mounted.current) setBusy(false);
      changed.current();
    }
  };

  const make = async () => {
    setConfirming(false);
    setBusy(true);
    setSummary(null);
    setError(null);
    setOverBudget(false);
    setFailures([]);
    stop.current = false;
    const failed: string[] = [];
    const started: Started[] = [];
    let ready = true;
    try {
      // 1. Start a clip for each moving picture without one (it starts from the chosen picture).
      for (const [i, s] of toAnimate.entries()) {
        if (i > 0) await delay(START_GAP_MS, abort.current.signal);
        if (stop.current || !mounted.current) break;
        setProgress(`Starting clip ${i + 1} of ${toAnimate.length}…`);
        const r = await post(`${base}/shots/${shotKey(s)}/video`);
        if (r.ok && r.data?.jobId) {
          started.push({ jobId: String(r.data.jobId), shot: s });
          continue;
        }
        ready = false;
        if (!r.ok && r.status === STOPPED) break;
        if (!r.ok && (r.status === 402 || r.status === 401 || r.status === 403)) {
          setError(r.error);
          setOverBudget(r.status === 402);
          break;
        }
        failed.push(`${nameOf(s)}: ${!r.ok && r.status === 0 ? 'The connection dropped; the clip may have started.' : r.ok ? 'No job was started.' : r.error}`);
      }
      if (stop.current) ready = false;
      // 2. Follow them to the end.
      const made = new Map<string, string>();
      if (started.length) {
        changed.current();
        setRendering(true);
        const res = await followClips(vsId, started, {
          ...ctl(),
          onProgress: (done, n) => setProgress(`Animating: ${done} of ${n} clips finished…`),
        });
        setRendering(false);
        for (const j of res.succeeded) made.set(shotKey(j.shot), candIdForJob(j.jobId));
        failed.push(...res.failed.map((f) => `${nameOf(f.shot)}: ${f.error}`));
        if (res.open) {
          failed.push(`${res.open} clip${res.open === 1 ? ' is' : 's are'} still rendering. Press Make the video again in a few minutes.`);
          ready = false;
        }
        if (res.failed.length) ready = false;
      }
      if (!ready || !mounted.current) return;
      // 3. Choose what each shot shows: its clip when moving, its picture when still.
      setProgress('Choosing each picture and clip…');
      for (const s of rows) {
        const want = isMoving(s) ? (made.get(shotKey(s)) ?? clipOf(s)?.candId) : picOf(s)?.candId;
        if (!want || want === s.selectedCandidateId) continue;
        const r = await post(`${base}/select`, { sceneOrder: s.sceneOrder, shotOrder: s.shotOrder, candId: want });
        if (!r.ok) {
          failed.push(`${nameOf(s)}: ${r.error}`);
          ready = false;
        }
      }
      if (!ready) return;
      // 4. Render the whole story.
      setProgress('Starting the render…');
      const r = await post(`${base}/render`);
      if (!r.ok) {
        setError(r.error);
        ready = false;
      }
    } finally {
      if (mounted.current) {
        setSummary(ready ? 'The video is rendering. It appears in Render video above in a few minutes.' : 'Not rendered. Fix what is listed below, then press Make the video again.');
        setFailures(failed);
        setProgress(null);
        setRendering(false);
        setBusy(false);
        changed.current();
      }
    }
  };

  return (
    <section aria-label="Video from your pictures" className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Video from your pictures</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Add your pictures in order, set each one&apos;s seconds, and choose Moving (Grok animates it from your picture) or Still (a slow zoom). Then make the whole video in one go.
      </p>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        Add pictures (JPEG or PNG, free)
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png"
          disabled={busy}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            void addPictures(list);
          }}
          className="mt-1 block text-sm"
        />
      </label>

      {rows.length > 0 && (
        <ol aria-label="Your pictures" className="space-y-2">
          {rows.map((s) => {
            const name = nameOf(s);
            const p = picOf(s);
            return (
              <li key={shotKey(s)} className="flex flex-wrap items-start gap-3 rounded-md border border-gray-200 p-2 text-sm dark:border-gray-700">
                {p ? <Thumb s3Key={p.s3Key} alt={name} aspect={story.aspectRatio} small /> : <span className="h-14 w-14 rounded bg-gray-100 dark:bg-gray-800" />}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{name}</span>
                    <input
                      type="number"
                      min={MIN_FIT_SEC}
                      max={MAX_FIT_SEC}
                      aria-label={`Seconds for ${name.toLowerCase()}`}
                      defaultValue={s.durationSec}
                      key={`${shotKey(s)}-${s.durationSec}`}
                      disabled={busy}
                      onBlur={(e) => {
                        const v = Math.round(Number(e.target.value));
                        if (v >= MIN_FIT_SEC && v <= MAX_FIT_SEC && v !== s.durationSec) void update(s, { durationSec: v }).then(() => changed.current());
                      }}
                      className="w-16 rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
                    />
                    <span className="text-gray-600 dark:text-gray-400">s</span>
                    <select
                      aria-label={`How ${name.toLowerCase()} plays`}
                      value={isMoving(s) ? 'moving' : 'still'}
                      disabled={busy}
                      onChange={(e) => void update(s, { mode: e.target.value === 'moving' ? 'HERO' : 'STILL' }).then(() => changed.current())}
                      className="rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
                    >
                      <option value="still">Still (slow zoom, free)</option>
                      <option value="moving">{`Moving (${usd(estimateCostUsd('grok', 'HERO', s.durationSec))})`}</option>
                    </select>
                    {isMoving(s) && clipOf(s) && <span className="text-green-700 dark:text-green-400">Clip made</span>}
                  </div>
                  {isMoving(s) && (
                    <label className="block text-gray-700 dark:text-gray-300">
                      How it moves
                      <textarea
                        rows={2}
                        maxLength={2000}
                        defaultValue={s.visualPrompt}
                        key={`${shotKey(s)}-p-${s.visualPrompt}`}
                        disabled={busy}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== s.visualPrompt) void update(s, { visualPrompt: v }).then(() => changed.current());
                        }}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
                      />
                    </label>
                  )}
                  {!p && <p className="text-red-600 dark:text-red-400">{`${name} has no picture yet.`}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={fits ? 'text-gray-700 dark:text-gray-300' : 'font-medium text-amber-700 dark:text-amber-400'}>{`Total ${total} s of ${windowSec} s`}</span>
          {!fits && (
            <button type="button" disabled={busy} onClick={() => void fit()} className="rounded-md border border-gray-300 px-2 py-1 text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300">
              {`Fit to ${windowSec} s`}
            </button>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <button
          type="button"
          disabled={!canMake}
          onClick={() => setConfirming(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {`Make the video (${toAnimate.length} moving · ${usd(price)})`}
        </button>
      )}

      {confirming && !busy && (
        <div role="dialog" aria-label="Confirm the video" className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-gray-800 dark:text-gray-200">
            {toAnimate.length === 0
              ? 'Render the whole video now? It is free.'
              : `Animate ${toAnimate.length} picture${toAnimate.length === 1 ? '' : 's'} for ${usd(price)}, then render the whole video?`}
          </p>
          <p className="text-gray-600 dark:text-gray-400">{`Story total after this: ${usd(after)} of ${usd(story.budgetUsdCap)}`}</p>
          {overCap && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-red-600 dark:text-red-400">That is over this story&apos;s budget cap.</p>
              <RaiseBudgetButton />
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => void make()} disabled={overCap} className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
              Confirm
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      {progress && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <span>{progress}</span>
          {rendering ? (
            <span className="text-gray-600 dark:text-gray-400">The clips keep rendering even if you leave this page.</span>
          ) : (
            busy && (
              <button type="button" onClick={() => (stop.current = true)} className="text-blue-700 hover:underline dark:text-blue-400">
                Stop
              </button>
            )
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
        <ul aria-label="What went wrong" className="list-disc pl-5 text-sm text-red-600 dark:text-red-400">
          {failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
