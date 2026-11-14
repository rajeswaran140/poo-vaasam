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
 * window ("Fit to N s" scales them, 1-15 s each).
 *
 * Chaining: a moving row after a moving row can "continue from the previous
 * picture's clip". Its clip is made after the previous one ends: the browser
 * grabs that clip's last frame, uploads it to this row and pins it as the first
 * frame, so the motion runs on across the cut. Chained rows go one after
 * another; the others are started together. Paid requests go one at a
 * time through the shot routes (visual-story-runner), so the budget cap holds.
 * Errors render here.
 *
 * Your own clips: an MP4 the owner made elsewhere (e.g. in Grok) becomes a row
 * of its own, marked by OWN_CLIP_PROMPT. It keeps the clip's own length (read
 * in the browser), is never sent to Grok, costs nothing, and "Fit" leaves its
 * seconds alone. A later moving row may still continue from it.
 *
 * Keeping faces: each moving picture lists who is in it (the story's
 * Characters, all ticked on a new row). Their reference photos go to Grok with
 * the picture, so the couple keeps the same faces from clip to clip.
 */

import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';
import { delay } from '@/lib/poll-job';
import { estimateAssembleSec, MAX_ASSEMBLE_SEC } from '@/lib/visual-story-assemble';
import { fitDurations, MAX_FIT_SEC, MIN_FIT_SEC } from '@/lib/visual-story-fit';
import { clipFitFor, maxRowSecFor } from '@/lib/visual-story-clip-fit';
import { grabLastFrame } from '@/lib/visual-story-last-frame';
import { candidateKey } from '@/lib/visual-story-keys';
import { followClips, postWithRetry, STOPPED, type Started } from '@/lib/visual-story-runner';
import { clipPriceUsd } from '@/lib/visual-story-video-inputs';
import { clipRowSeconds, readClipDuration } from '@/lib/visual-story-clip-length';
import { candIdForJob, OWN_CLIP_PROMPT, roundTenth, sameSec } from '@/types/visualStory';
import type { Candidate, Character, GenJob, Scene, Shot, VisualStory } from '@/types/visualStory';
import { RaiseBudgetButton, shotKey, Thumb, usd, VideoThumb } from './ui-utils';

const DEFAULT_SECONDS = 8;
/** A shot needs a prompt; for a picture it says how the picture should move. */
export const DEFAULT_MOTION = 'Gentle, natural movement. Keep the people, place and colours exactly as in the picture.';
const SCENE_HEADING = 'Your pictures';
const START_GAP_MS = 3000;

const isMoving = (s: Shot) => s.mode !== 'STILL';
/** A row holding the owner's own uploaded clip. */
const isOwn = (s: Shot) => s.visualPrompt === OWN_CLIP_PROMPT;
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
  /** The story's people; their photos keep the faces the same in every clip. */
  characters?: Character[];
  onChanged: () => void;
}

export function PicturePanel({ vsId, story, scenes, shots, candidates, genJobs, characters = [], onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [overBudget, setOverBudget] = useState(false);
  const [rendering, setRendering] = useState(false);
  // Stop is offered only while the video is being made (not during uploads or Fit).
  const [making, setMaking] = useState(false);
  // Stop pressed during Make the video: the clip being made finishes, nothing new starts.
  const [stopping, setStopping] = useState(false);
  // Bumped when a save fails, so the seconds boxes show the saved value again.
  const [nonce, setNonce] = useState(0);
  // The row whose Remove is waiting for a yes (shotKey), and a remove that failed.
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ key: string; message: string } | null>(null);
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

  // Only a story built here: a drafted story's shots are left to the shot cards.
  const pictureScenes = scenes.filter((sc) => sc.heading === SCENE_HEADING).map((sc) => sc.order);
  const ownsStory = shots.every((s) => pictureScenes.includes(s.sceneOrder));
  const rows = [...shots].sort((a, b) => a.sceneOrder - b.sceneOrder || a.shotOrder - b.shotOrder);
  const nameOf = (s: Shot) => `${isOwn(s) ? 'Clip' : 'Picture'} ${rows.indexOf(s) + 1}`;
  const windowSec = story.windowEndSec - story.windowStartSec;
  const total = rows.reduce((n, s) => n + s.durationSec, 0);
  const picOf = (s: Shot) => {
    const sel = candidates.find((c) => c.candId === s.selectedCandidateId && of(s)(c));
    return sel?.mode === 'STILL' ? sel : newest(candidates.filter((c) => of(s)(c) && c.mode === 'STILL'));
  };
  const clipOf = (s: Shot) => newest(candidates.filter((c) => of(s)(c) && c.mode !== 'STILL'));
  /** The owner's uploaded clip for an own-clip row. */
  const ownClipOf = (s: Shot) => newest(candidates.filter((c) => of(s)(c) && c.mode !== 'STILL' && c.providerId === 'upload'));
  const jobNow = (s: Shot) => genJobs.find((j) => of(s)(j) && (j.status === 'submitted' || j.status === 'running'));
  const rendersNow = (s: Shot) => !!jobNow(s);
  const prevOf = (s: Shot) => rows[rows.indexOf(s) - 1];
  /** Continues from the previous row's clip: both moving, and the owner asked for it. */
  const chained = (s: Shot) => !isOwn(s) && !!s.chainFromPrevious && isMoving(s) && !!prevOf(s) && isMoving(prevOf(s)!);
  /**
   * A chained row's clip is current only while it was made from the previous
   * row's current clip (chainedFromCandId); once that clip is re-made — or is
   * about to be — the chained clip is made again from the new last frame.
   */
  /**
   * The made clip's length, when the row can no longer use it: the row needs it
   * slower than 88 %, or would cut a clip the next row continues from
   * (visual-story-clip-fit.ts; a shorter row just trims). Only clips made since
   * lengths were recorded (2026-11-13) can be checked this way.
   */
  const nextOf = (s: Shot) => rows[rows.indexOf(s) + 1];
  const clipFitOfRow = (s: Shot) => {
    const len = clipOf(s)?.durationSec;
    const next = nextOf(s);
    return clipFitFor(typeof len === 'number' ? len : null, s.durationSec, { continuedFrom: !!next && chained(next) });
  };
  const staleLengthOf = (s: Shot): number | null => {
    const len = clipOf(s)?.durationSec;
    return typeof len === 'number' && clipFitOfRow(s).kind === 'stale' ? len : null;
  };
  const staleNote = (s: Shot, len: number) =>
    s.durationSec < len
      ? `Its clip is ${len} s and the next row continues from its last frame, so it cannot be cut to ${s.durationSec} s. Make the video makes it again, or set the seconds back to ${len}.`
      : `Its clip is ${len} s; this row needs it slower than 88 %. Make the video makes it again for ${Math.ceil(s.durationSec)} s, or shorten the row to ${maxRowSecFor(len)} s or less.`;
  const needsClip = (s: Shot): boolean => {
    if (isOwn(s) || !isMoving(s) || rendersNow(s)) return false;
    if (!clipOf(s)) return true;
    if (clipFitOfRow(s).kind === 'stale') return true;
    if (!chained(s)) return false;
    const prev = prevOf(s)!;
    return needsClip(prev) || s.chainedFromCandId !== clipOf(prev)?.candId;
  };
  const toAnimate = rows.filter(needsClip);
  // Every clip starts from a frame sent with it: a chained row's (the previous clip's end) and a
  // row's own picture are both pinned just before its clip, so price that frame too.
  const priceOf = (s: Shot) => clipPriceUsd({ characters, candidates }, s, { assumeFirstFrame: chained(s) || !!picOf(s) });
  const price = toAnimate.reduce((n, s) => n + priceOf(s), 0);
  const missing = rows.filter((s) => (isOwn(s) ? !ownClipOf(s) : !picOf(s) && !chained(s)));
  const fits = sameSec(total, windowSec);
  const after = story.spentUsd + story.reservedUsd + price;
  const overCap = after > story.budgetUsdCap + 1e-9;
  // The worker's own limit, checked before anything is paid (clips assemble faster than stills).
  const workSec = estimateAssembleSec(rows.map((s) => ({ key: isMoving(s) ? 'clip.mp4' : 'picture.jpg', durationSec: s.durationSec })));
  const tooLong = workSec > MAX_ASSEMBLE_SEC;
  const canMake = rows.length > 0 && fits && missing.length === 0 && !tooLong && !busy;
  // Moving pictures missing someone (e.g. added before the characters existed).
  const everyone = characters.map((c) => c.charId).slice(0, 14);
  const missingPeople = rows.filter((s) => isMoving(s) && !isOwn(s) && everyone.some((id) => !s.charIds.includes(id)));

  const update = async (s: Shot, fields: Record<string, unknown>) => {
    setError(null);
    const r = await post(`${base}/shots`, { op: 'update', sceneOrder: s.sceneOrder, shotOrder: s.shotOrder, ...fields });
    if (!r.ok) {
      setError(`${nameOf(s)}: ${r.error || 'Not saved.'}`);
      setNonce((n) => n + 1);
    }
    return r.ok;
  };

  /** Upload one picture (or one of your own clips) to a shot; the new candidate's id. */
  const uploadTo = async (
    target: Pick<Shot, 'sceneOrder' | 'shotOrder'>,
    file: File,
    onProgress: (loaded: number, total: number) => void = () => {}
  ): Promise<{ ok: true; candId?: string } | { ok: false; error: string }> => {
    const url = `${base}/shots/${shotKey(target)}/upload`;
    const presign = await post(url, { op: 'presign', contentType: file.type, size: file.size });
    if (!presign.ok) return { ok: false, error: presign.error };
    const p = presign.data as { uploadUrl: string; fields: Record<string, string>; key: string };
    try {
      await putToS3(p.uploadUrl, p.fields, file, onProgress, abort.current.signal);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'The upload failed.' };
    }
    const ok = await post(url, { op: 'confirm', key: p.key });
    if (!ok.ok) return { ok: false, error: ok.error };
    return { ok: true, candId: (ok.data?.candidate as { candId?: string } | undefined)?.candId };
  };

  const addPictures = async (files: File[]) => {
    if (busy || files.length === 0) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    setFailures([]);
    stop.current = false;
    const failed: string[] = [];
    try {
      let sceneOrder = pictureScenes.length ? Math.max(...pictureScenes) : 0;
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
        // Everyone is in a new picture until the owner unticks them.
        const made = await post(`${base}/shots`, {
          op: 'create', sceneOrder, mode: 'STILL', durationSec: DEFAULT_SECONDS, visualPrompt: DEFAULT_MOTION,
          charIds: characters.map((c) => c.charId).slice(0, 14),
        });
        const created = made.ok ? (made.data?.shot as Pick<Shot, 'sceneOrder' | 'shotOrder'> | undefined) : undefined;
        if (!created) {
          failed.push(`${file.name}: ${made.ok ? 'Could not add it.' : made.error}`);
          continue;
        }
        const up = await uploadTo(created, file);
        if (!up.ok) failed.push(`${file.name}: ${up.error}`);
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

  /** Each clip becomes a row of its own, at the clip's own length, in the order picked. */
  const addClips = async (files: File[]) => {
    if (busy || files.length === 0) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    setFailures([]);
    stop.current = false;
    const failed: string[] = [];
    try {
      let sceneOrder = pictureScenes.length ? Math.max(...pictureScenes) : 0;
      if (!sceneOrder) {
        const r = await post(`${base}/scenes`, { op: 'create', heading: SCENE_HEADING, summary: '' });
        const order = r.ok ? Number((r.data?.scene as { order?: number } | undefined)?.order) : NaN;
        if (!r.ok || !order) {
          setError(r.ok ? 'Could not add the clips.' : r.error);
          return;
        }
        sceneOrder = order;
      }
      for (const [i, file] of files.entries()) {
        if (!mounted.current) break;
        const n = `clip ${i + 1} of ${files.length} (${file.name})`;
        setProgress(`Reading ${n}…`);
        const len = clipRowSeconds(await readClipDuration(file));
        if (!len.ok) {
          failed.push(`${file.name}: ${len.error}`);
          continue;
        }
        const made = await post(`${base}/shots`, { op: 'create', sceneOrder, mode: 'HERO', durationSec: len.seconds, visualPrompt: OWN_CLIP_PROMPT });
        const created = made.ok ? (made.data?.shot as Pick<Shot, 'sceneOrder' | 'shotOrder'> | undefined) : undefined;
        if (!created) {
          failed.push(`${file.name}: ${made.ok ? 'Could not add it.' : made.error}`);
          continue;
        }
        const up = await uploadTo(created, file, (done, all) => setProgress(`Uploading ${n}… ${all ? Math.round((done / all) * 100) : 0}%`));
        if (!up.ok) failed.push(`${file.name}: ${up.error}`);
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
    // Your own clips and clips already made keep their length (stretching a made
    // clip freezes it, shrinking it cuts it); the rest share what is left.
    const keeps = (s: Shot) => isOwn(s) || (isMoving(s) && !!clipOf(s) && !needsClip(s));
    const flexible = rows.filter((s) => !keeps(s));
    const fixedSec = roundTenth(rows.reduce((n, s) => n + (keeps(s) ? s.durationSec : 0), 0));
    // Rows a lyrics fit left in tenths: fit the rest in whole seconds, and give the leftover tenths to the last.
    const leftSec = roundTenth(windowSec - fixedSec);
    const wholeLeft = Math.floor(leftSec);
    const spare = roundTenth(leftSec - wholeLeft);
    let next = flexible.length ? fitDurations(flexible.map((s) => s.durationSec), wholeLeft) : null;
    if (next && spare > 0) {
      const last = next.length - 1;
      next = next[last] + spare <= MAX_FIT_SEC ? next.map((d, i) => (i === last ? roundTenth(d + spare) : d)) : null;
    }
    if (!next) {
      setError(
        fixedSec
          ? `${rows.some((s) => keeps(s) && !isOwn(s)) ? 'Your clips and the clips already made' : 'Your clips'} take ${fixedSec} s, so ${flexible.length} picture${flexible.length === 1 ? '' : 's'} must fill ${leftSec} s at ${MIN_FIT_SEC}-${MAX_FIT_SEC} s each. Add or remove pictures.`
          : `${rows.length} pictures cannot fill ${windowSec} s at ${MIN_FIT_SEC}-${MAX_FIT_SEC} s each. Add or remove pictures.`
      );
      return;
    }
    setBusy(true);
    stop.current = false;
    try {
      for (const [i, s] of flexible.entries()) {
        if (!sameSec(next[i], s.durationSec) && !(await update(s, { durationSec: next[i] }))) break;
      }
    } finally {
      if (mounted.current) setBusy(false);
      changed.current();
    }
  };

  /** Tick every character in every moving picture, in one go. */
  const tickEveryone = async () => {
    setBusy(true);
    setError(null);
    stop.current = false;
    try {
      for (const s of missingPeople) {
        if (!mounted.current || !(await update(s, { charIds: [...new Set([...s.charIds, ...everyone])] }))) break;
      }
    } finally {
      if (mounted.current) setBusy(false);
      changed.current();
    }
  };

  const remove = async (s: Shot) => {
    setBusy(true);
    setError(null);
    stop.current = false;
    try {
      const r = await post(`${base}/shots`, { op: 'delete', sceneOrder: s.sceneOrder, shotOrder: s.shotOrder });
      if (!r.ok) setRemoveError({ key: shotKey(s), message: r.error });
    } finally {
      if (mounted.current) setBusy(false);
      changed.current();
    }
  };

  /** Paid Grok clips this row holds (the owner's uploads are free). */
  const paidClipsOf = (s: Shot) => candidates.filter((c) => of(s)(c) && c.mode !== 'STILL' && c.providerId !== 'upload');

  /**
   * Remove asks first: deleting a row deletes everything in it, paid clips
   * included, and they cannot be brought back (audit 2026-11-13: one tap on
   * the small link threw away clips that then had to be paid for again).
   */
  const removeButton = (s: Shot, name: string) => (
    <button
      type="button"
      disabled={busy || removing === shotKey(s)}
      aria-label={`Remove ${name.toLowerCase()}`}
      onClick={() => {
        setRemoveError(null);
        setRemoving(shotKey(s));
      }}
      className="min-h-11 min-w-11 text-blue-700 hover:underline disabled:opacity-50 lg:min-h-0 lg:min-w-0 dark:text-blue-400"
    >
      Remove
    </button>
  );

  /** What Remove deletes, said plainly, in the row itself. */
  const removeMessage = (s: Shot, name: string): string => {
    if (isOwn(s)) return `Remove ${name.toLowerCase()}? Your uploaded clip is taken out of this story.`;
    const paid = paidClipsOf(s).length;
    const pictures = candidates.filter((c) => of(s)(c) && c.mode === 'STILL').length;
    const what = [
      pictures ? (pictures === 1 ? 'its picture' : `its ${pictures} pictures`) : '',
      paid ? (paid === 1 ? 'the clip made for it' : `the ${paid} clips made for it`) : '',
    ].filter(Boolean);
    const lead = `Remove ${name.toLowerCase()}?`;
    if (!what.length) return lead;
    const deleted = `${what.join(' and ')} ${what.length > 1 || pictures > 1 || paid > 1 ? 'are' : 'is'} deleted.`;
    const repay = paid ? ` ${paid === 1 ? 'That clip was' : 'Those clips were'} paid for; making ${paid === 1 ? 'it' : 'them'} again costs again.` : '';
    return `${lead} ${deleted.charAt(0).toUpperCase()}${deleted.slice(1)}${repay}`;
  };

  const removeConfirm = (s: Shot, name: string) => {
    const key = shotKey(s);
    const failed = removeError?.key === key ? removeError.message : null;
    if (removing !== key && !failed) return null;
    return (
      <div role={failed ? 'alert' : undefined} className="w-full space-y-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm dark:border-red-900 dark:bg-red-950">
        {failed ? (
          <p className="text-red-700 dark:text-red-300">{`Could not remove ${name.toLowerCase()}: ${failed}`}</p>
        ) : (
          <>
            <p className="text-gray-900 dark:text-gray-100">{removeMessage(s, name)}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setRemoving(null);
                  void remove(s);
                }}
                className="min-h-11 rounded-md bg-red-600 px-3 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50 lg:min-h-0"
              >
                {`Yes, remove ${name.toLowerCase()}`}
              </button>
              <button
                type="button"
                onClick={() => setRemoving(null)}
                className="min-h-11 rounded-md border border-gray-300 px-3 py-1 text-gray-800 hover:bg-gray-100 lg:min-h-0 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Keep
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  /** Grab the previous clip's last frame, upload it to `s`, pin it, and start `s`'s clip. */
  const continueFrom = async (
    s: Shot,
    prevClip: { candId: string; s3Key: string }
  ): Promise<{ ok: true; jobId: string } | { ok: false; error: string; stop?: boolean }> => {
    // Already copied from this very clip (a re-run after a refusal): reuse that frame, upload nothing.
    const reuse = s.chainedFromCandId === prevClip.candId && !!s.firstFrameCandidateId;
    if (!reuse) {
      let blob: Blob;
      try {
        // A fresh signature each time: a copy cached without CORS headers would taint the canvas.
        const res = await adminFetch(`/api/admin/mastering/download?key=${encodeURIComponent(prevClip.s3Key)}&mode=play`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success || !json.url) return { ok: false, error: 'Could not open the previous clip.' };
        blob = await grabLastFrame(String(json.url));
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Could not copy the last frame.' };
      }
      const up = await uploadTo(s, new File([blob], 'last-frame.jpg', { type: 'image/jpeg' }));
      if (!up.ok) return { ok: false, error: up.error };
      if (!up.candId) return { ok: false, error: 'The last frame was not saved.' };
      const pinned = await post(`${base}/shots`, {
        op: 'update', sceneOrder: s.sceneOrder, shotOrder: s.shotOrder, firstFrameCandidateId: up.candId, chainedFromCandId: prevClip.candId,
      });
      if (!pinned.ok) return { ok: false, error: pinned.error, stop: pinned.status === STOPPED };
    }
    const r = await post(`${base}/shots/${shotKey(s)}/video`);
    if (r.ok && r.data?.jobId) return { ok: true, jobId: String(r.data.jobId) };
    if (!r.ok && (r.status === 402 || r.status === 401 || r.status === 403)) {
      setError(r.error);
      setOverBudget(r.status === 402);
      return { ok: false, error: r.error, stop: true };
    }
    return { ok: false, error: r.ok ? 'No job was started.' : r.status === 0 ? 'The connection dropped; the clip may have started.' : r.error, stop: !r.ok && r.status === STOPPED };
  };

  const make = async () => {
    setConfirming(false);
    setBusy(true);
    setMaking(true);
    setStopping(false);
    setSummary(null);
    setError(null);
    setOverBudget(false);
    setFailures([]);
    stop.current = false;
    const failed: string[] = [];
    // A moving picture's clip already rendering is followed too: it is paid for, so it is used.
    const started: Started[] = rows.flatMap((s) => {
      const j = isMoving(s) && !clipOf(s) ? jobNow(s) : undefined;
      return j ? [{ jobId: j.jobId, shot: s }] : [];
    });
    let ready = true;
    // A budget or sign-in refusal: start nothing more (the chain would only copy frames for nothing).
    let halted = false;
    try {
      // 1. Start a clip for each moving picture without one (it starts from the chosen picture);
      //    chained rows wait for the clip before them (step 2b).
      const heads = toAnimate.filter((s) => !chained(s));
      const chains = toAnimate.filter(chained);
      for (const [i, s] of heads.entries()) {
        if (i > 0) await delay(START_GAP_MS, abort.current.signal);
        if (stop.current || !mounted.current) break;
        setProgress(`Starting clip ${i + 1} of ${heads.length}…`);
        // Pin the picture, so the clip — and any re-make after the clip is chosen — starts from it.
        const picture = picOf(s);
        if (picture && s.firstFrameCandidateId !== picture.candId) {
          const pinned = await post(`${base}/shots`, { op: 'update', sceneOrder: s.sceneOrder, shotOrder: s.shotOrder, firstFrameCandidateId: picture.candId });
          if (!pinned.ok) {
            ready = false;
            if (pinned.status === STOPPED) break;
            failed.push(`${nameOf(s)}: ${pinned.error}`);
            continue;
          }
        }
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
          halted = true;
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
      // 2b. Chained rows, in order: each starts from the last frame of the clip before it.
      for (const s of chains) {
        if (stop.current || halted || !mounted.current) {
          ready = false;
          break;
        }
        const prev = prevOf(s)!;
        const madeId = made.get(shotKey(prev));
        const existing = clipOf(prev);
        // A clip made in this run is stored where gen-job stores every clip; an older one by its own key.
        const prevClip = madeId
          ? { candId: madeId, s3Key: candidateKey(vsId, madeId, 'mp4') }
          : existing && !needsClip(prev)
            ? { candId: existing.candId, s3Key: existing.s3Key }
            : undefined;
        if (!prevClip) {
          failed.push(`${nameOf(s)}: ${nameOf(prev).toLowerCase()} has no clip, so it cannot continue from it.`);
          ready = false;
          continue;
        }
        setProgress(`Continuing ${nameOf(s).toLowerCase()} from ${nameOf(prev).toLowerCase()}…`);
        const r = await continueFrom(s, prevClip);
        if (!r.ok) {
          failed.push(`${nameOf(s)}: ${r.error}`);
          ready = false;
          if (r.stop) {
            halted = true;
            break;
          }
          continue;
        }
        setRendering(true);
        const res = await followClips(vsId, [{ jobId: r.jobId, shot: s }], {
          ...ctl(),
          onProgress: () => setProgress(`Animating ${nameOf(s).toLowerCase()}…`),
        });
        setRendering(false);
        if (res.succeeded.length) made.set(shotKey(s), candIdForJob(r.jobId));
        else {
          failed.push(res.failed.length ? `${nameOf(s)}: ${res.failed[0].error}` : `${nameOf(s)}: its clip is still rendering. Press Make the video again in a few minutes.`);
          ready = false;
        }
      }
      if (!ready || !mounted.current) return;
      // 3. Choose what each shot shows: its clip when moving, its picture when still.
      setProgress('Choosing each picture and clip…');
      for (const s of rows) {
        const want = isOwn(s)
          ? ownClipOf(s)?.candId
          : isMoving(s)
            ? (made.get(shotKey(s)) ?? clipOf(s)?.candId)
            : picOf(s)?.candId;
        if (!want) {
          failed.push(`${nameOf(s)}: ${isMoving(s) ? 'it has no clip yet.' : 'it has no picture yet.'}`);
          ready = false;
          continue;
        }
        if (want === s.selectedCandidateId) continue;
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
        setMaking(false);
        setStopping(false);
        setBusy(false);
        changed.current();
      }
    }
  };

  if (!ownsStory) return null;

  return (
    <section aria-label="Video from your pictures" className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Video from your pictures</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Add your pictures in order, set each one&apos;s seconds, and choose Moving (Grok animates it from your picture) or Still (a slow zoom). You can also add clips you made yourself: each keeps its own length. Then make the whole video in one go.
      </p>
      {characters.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          To keep the same faces in every clip, add the people (for example the husband and the wife) in the Characters tab, each with a few clear face photos. New pictures then include them.
        </p>
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Each moving picture sends Grok the face photos of the people ticked in it, so their faces stay the same from clip to clip. Untick anyone who is not in that picture. A clip with face photos is made at 720p (Grok&apos;s limit for them); with nobody ticked it is made at 1080p.
        </p>
      )}
      {missingPeople.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void tickEveryone()}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
        >
          {`Put everyone in every moving picture (${missingPeople.length} to update)`}
        </button>
      )}
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
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        Add your own clips (MP4, free; each keeps its own length, sound is not used)
        <input
          type="file"
          multiple
          accept="video/mp4"
          disabled={busy}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            void addClips(list);
          }}
          className="mt-1 block text-sm"
        />
      </label>

      {rows.length > 0 && (
        <ol aria-label="Your pictures" className="space-y-2">
          {rows.map((s) => {
            const name = nameOf(s);
            const p = picOf(s);
            if (isOwn(s)) {
              const clip = ownClipOf(s);
              return (
                <li key={shotKey(s)} className="flex flex-wrap items-start gap-3 rounded-md border border-gray-200 p-2 text-sm dark:border-gray-700">
                  {clip ? (
                    // Playable, so the order of the clips can be checked before the render.
                    <VideoThumb s3Key={clip.s3Key} label={`${name} preview`} />
                  ) : (
                    <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded bg-gray-100 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      MP4
                    </span>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{name}</span>
                      <span className="text-gray-700 dark:text-gray-300">{`${s.durationSec} s · your clip (free)`}</span>
                      {removeButton(s, name)}
                    </div>
                    {removeConfirm(s, name)}
                    {!clip && <p className="text-red-600 dark:text-red-400">{`${name} has no clip yet. Remove it and add the clip again.`}</p>}
                  </div>
                </li>
              );
            }
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
                      step={0.1}
                      aria-label={`Seconds for ${name.toLowerCase()}`}
                      defaultValue={s.durationSec}
                      key={`${shotKey(s)}-${s.durationSec}-${nonce}`}
                      disabled={busy}
                      onBlur={(e) => {
                        // A clip the next row continues from is never trimmed, and Grok makes whole seconds.
                        const next = nextOf(s);
                        const v = next && chained(next) ? Math.round(Number(e.target.value)) : roundTenth(Number(e.target.value));
                        if (v >= MIN_FIT_SEC && v <= MAX_FIT_SEC && !sameSec(v, s.durationSec)) void update(s, { durationSec: v }).then(() => changed.current());
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
                      <option value="moving">{`Moving (${usd(priceOf(s))})`}</option>
                    </select>
                    {isMoving(s) && clipOf(s) && !needsClip(s) && <span className="text-green-700 dark:text-green-400">Clip made</span>}
                    {isMoving(s) && staleLengthOf(s) !== null && (
                      <span className="text-amber-700 dark:text-amber-400">
                        {staleNote(s, staleLengthOf(s)!)}
                      </span>
                    )}
                    {removeButton(s, name)}
                  </div>
                  {removeConfirm(s, name)}
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
                  {isMoving(s) && characters.length > 0 && (
                    <fieldset className="flex flex-wrap items-center gap-3 text-gray-700 dark:text-gray-300">
                      <legend className="sr-only">{`Who is in ${name.toLowerCase()}`}</legend>
                      <span>In this picture:</span>
                      {characters.map((c) => (
                        <label key={c.charId} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            aria-label={`${c.name} is in ${name.toLowerCase()}`}
                            checked={s.charIds.includes(c.charId)}
                            disabled={busy}
                            onChange={(e) => {
                              const next = e.target.checked ? [...s.charIds, c.charId] : s.charIds.filter((id) => id !== c.charId);
                              void update(s, { charIds: next }).then(() => changed.current());
                            }}
                          />
                          {c.name}
                          {(c.refImageKeys ?? []).length === 0 && <span className="text-amber-700 dark:text-amber-400">(no photos yet)</span>}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {isMoving(s) && prevOf(s) && isMoving(prevOf(s)!) && (
                    <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        aria-label={`${name} continues from ${nameOf(prevOf(s)!).toLowerCase()}`}
                        checked={!!s.chainFromPrevious}
                        disabled={busy}
                        onChange={(e) => void update(s, { chainFromPrevious: e.target.checked }).then(() => changed.current())}
                      />
                      {`Continue from ${nameOf(prevOf(s)!).toLowerCase()}'s clip (smooth cut; made after it)`}
                    </label>
                  )}
                  {chained(s) && !clipOf(s) && <p className="text-gray-600 dark:text-gray-400">{`Starts where ${nameOf(prevOf(s)!).toLowerCase()} ends.`}</p>}
                  {chained(s) && clipOf(s) && needsClip(s) && (
                    <p className="text-amber-700 dark:text-amber-400">{`Will be made again, to start where ${nameOf(prevOf(s)!).toLowerCase()} now ends.`}</p>
                  )}
                  {!p && !chained(s) && <p className="text-red-600 dark:text-red-400">{`${name} has no picture yet.`}</p>}
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

      {tooLong && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {`This video is too long to render in one go (about ${Math.ceil(workSec / 60)} minutes of work; the most is ${MAX_ASSEMBLE_SEC / 60}). Make more of the pictures Moving, or make a shorter story.`}
        </p>
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
          {/* Stop is offered for the whole run (audit 2026-11-13: it was hidden while
              each chained clip was made, so later paid clips could not be stopped). */}
          {making &&
            (stopping ? (
              <span className="text-gray-600 dark:text-gray-400">Stopping: the clips being made now finish (they are paid for), then no more start.</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  stop.current = true;
                  setStopping(true);
                }}
                className="min-h-11 text-blue-700 hover:underline lg:min-h-0 dark:text-blue-400"
              >
                Stop
              </button>
            ))}
          {rendering && !stopping && (
            <span className="text-gray-600 dark:text-gray-400">
              Keep this page open. If you leave, clips already started still finish, but no more start and the video is not rendered.
            </span>
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
