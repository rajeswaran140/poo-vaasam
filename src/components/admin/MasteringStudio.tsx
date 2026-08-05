'use client';

/**
 * Sound Engineering & Mastering — the whole module in one guided page.
 *
 * Pipeline this serves: export the WAV from SUNO -> upload here -> master to a
 * streaming target -> download the mastered WAV -> cut picture in Adobe.
 *
 * Things the UI is deliberately opinionated about, because each is a mistake
 * the API alone can't prevent:
 *  - WAV only. Mastering an MP3 re-levels a file that has already lost detail.
 *  - The master is measured on the way out (`afterLufs`), so "did it work?" is
 *    answered on screen instead of by downloading the file and trusting it.
 *  - Master ONCE. Premiere's "Auto-Match to -14" silently undoes the whole job,
 *    so the hand-off note sits next to the download button, not in a doc.
 *
 * The running job is mirrored into sessionStorage: the worker keeps going
 * whether or not this component is mounted, so navigating away (or a session
 * bounce) must not orphan a master that is about to land in S3.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  SlidersHorizontal, Upload, Download, Loader2, CheckCircle2,
  AlertTriangle, FileAudio, RotateCcw, X, Info, Save, Library, Play, Pause, Pencil, Link2, Film,
} from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { pollJob } from '@/lib/poll-job';
import { statusFor, platformLanding } from '@/lib/loudness-targets';
import { MAX_UPLOAD_BYTES, ACCEPTED_UPLOAD_TYPES, downloadFilename } from '@/lib/mastering-storage';
import { buildMasterReport, reportFilename, sourceInfoLine, dynamicsPreserved, streamingReadiness, joinLine } from '@/lib/master-report';
import { MasteringComparePlayer } from '@/components/admin/MasteringComparePlayer';
import { MasteringPlayer } from '@/components/admin/MasteringPlayer';
import { MasteringTrimPanel } from '@/components/admin/MasteringTrimPanel';
import { MasteringJoinPanel } from '@/components/admin/MasteringJoinPanel';
import { DEFAULT_CROSSFADE_CURVE, type MasterJoin } from '@/lib/master-join';
import { mp3PeakVerdict } from '@/lib/master-mp3';
import type { MasterEdit } from '@/lib/master-edit';
import type { MasterJob } from '@/types/masterJob';

/** Where the platforms normalise playback. */
const TARGETS = [
  { lufs: -14, label: '-14 LUFS', for: 'Spotify · YouTube · Amazon · TIDAL' },
  { lufs: -16, label: '-16 LUFS', for: 'Apple Music' },
] as const;

type Stage = 'idle' | 'uploading' | 'ready' | 'mastering' | 'done';

/** What survives a remount — enough to re-attach to a job still running. */
interface StoredJob {
  jobId: string;
  sourceKey: string;
  name: string;
  size: number;
  target: number;
  /**
   * The two-part assembly, if any. Persisted because the trim degrades
   * gracefully on a remount (the panel reappears empty and the admin sees it)
   * while a lost Part B does not: the join panel would come back collapsed, and
   * re-mastering to the second target would quietly produce Part A alone —
   * a different, shorter song, with nothing on screen saying so.
   */
  partBKey?: string;
  partBName?: string;
  overlapSec?: number;
  partBStartSec?: number;
}
const STORE_KEY = 'mastering-studio-job';

const readStored = (): StoredJob | null => {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as StoredJob) : null;
  } catch {
    return null;
  }
};
const writeStored = (j: StoredJob | null) => {
  try {
    if (j) sessionStorage.setItem(STORE_KEY, JSON.stringify(j));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode / quota — resume is a nicety, never a requirement */
  }
};

/**
 * True when a rejection is just our own AbortController firing — the admin
 * pressing "Cancel upload" / "Stop watching", or the component unmounting.
 *
 * These reached the shared `catch` and were rendered as red `role="alert"`
 * banners, so a deliberate cancel reported itself as a failure ("Upload
 * cancelled.") and stopping the watch could announce "Mastering failed." with a
 * raw "signal is aborted without reason" — for a job that was, in fact, still
 * running perfectly well server-side. A cancel is an outcome, not an error.
 */
const isAbort = (err: unknown): boolean =>
  (err instanceof DOMException && err.name === 'AbortError') ||
  (err instanceof Error && (err.name === 'AbortError' || /abort|cancel/i.test(err.message)));

const MB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const lufs = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(1)} LUFS` : '—');
const dbtp = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(2)} dBTP` : '—');
const lu = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(1)} LU` : '—');

/**
 * pollJob wants a Response but only ever reads `ok`, `status` and `json()`.
 * Building a real `new Response(...)` would tie this component to a Fetch
 * global that isn't guaranteed everywhere it runs, so hand back the minimal
 * shape instead.
 */
const asResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

/** Upload straight to S3 with progress. fetch() can't report upload progress. */
function putToS3(
  uploadUrl: string,
  fields: Record<string, string>,
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    // Every policy field first, the file part LAST — S3 requires this order.
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // S3 replies with an XML <Error><Code>…</Code></Error>; surfacing the code
      // turns an opaque "HTTP 403" into "ExpiredToken" / "EntityTooLarge".
      const code = /<Code>([^<]+)<\/Code>/.exec(xhr.responseText ?? '')?.[1];
      reject(new Error(`S3 rejected the upload (HTTP ${xhr.status}${code ? ` — ${code}` : ''}).`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/**
 * The join payload for a run: the two fields the panel owns, over whatever the
 * re-opened recipe carried.
 *
 * Rebuilding a seam from scratch is what would silently drop a saved non-default
 * curve or a fade on Part B — neither of which the panel can show, and both of
 * which change the audio. `trimStartSec` is always the panel's, including 0,
 * because clearing the head trim is a real instruction.
 */
export function buildJoinPayload(p: {
  partBKey: string;
  overlapSec: number;
  partBStartSec: number;
  seed: MasterJoin | null;
}): MasterJoin {
  const seedEditB = p.seed?.editB ?? null;
  const editB =
    p.partBStartSec > 0 || seedEditB
      ? {
          trimEndSec: null,
          fadeInSec: 0,
          fadeOutSec: 0,
          curve: DEFAULT_CROSSFADE_CURVE,
          ...(seedEditB ?? {}),
          trimStartSec: p.partBStartSec,
        }
      : null;
  return {
    partBKey: p.partBKey,
    overlapSec: p.overlapSec,
    curve: p.seed?.curve ?? DEFAULT_CROSSFADE_CURVE,
    editB,
  };
}

export function MasteringStudio() {
  const inputId = useId();
  const [stage, setStage] = useState<Stage>('idle');
  /** Name/size only — survives a remount, unlike a File handle. */
  const [source, setSource] = useState<{ name: string; size: number } | null>(null);
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [sent, setSent] = useState({ loaded: 0, total: 0 });
  const [target, setTarget] = useState<number>(-14);
  /**
   * The picked File, kept only so the trim panel can draw a waveform without a
   * round trip. Deliberately a ref-like state that is NOT persisted: `source`
   * above stores name/size precisely because a File handle cannot survive a
   * remount, and the trim panel degrades to numeric entry when this is null.
   */
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  /** Trim/fade for the next run; null means master the whole file. */
  const [edit, setEdit] = useState<MasterEdit | null>(null);
  /** Part B of a two-part assembly, once uploaded. Null = single-source master. */
  const [partB, setPartB] = useState<{ key: string; name: string } | null>(null);
  const [partBUploading, setPartBUploading] = useState(false);
  const [partBSent, setPartBSent] = useState({ loaded: 0, total: 0 });
  const [overlapSec, setOverlapSec] = useState(3);
  /** Head trim on Part B — how its entry is nudged onto the beat. */
  const [partBStartSec, setPartBStartSec] = useState(0);
  const [job, setJob] = useState<MasterJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // Optional human title for the export. Storage stays UUID-based; this only
  // shapes the download filename and the saved report. Empty ⇒ de-noised default.
  const [masterName, setMasterName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [dragging, setDragging] = useState(false);
  /** A job we stopped watching but which is still running — offers a way back. */
  const [paused, setPaused] = useState<StoredJob | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  /** Cover art for the YouTube render, once uploaded. */
  const [cover, setCover] = useState<{ key: string; name: string } | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [videoHeight, setVideoHeight] = useState<number>(1440);
  const [rendering, setRendering] = useState(false);
  /**
   * Bumped whenever a saved recipe is loaded. Used as a `key` on the edit
   * panels so they remount and re-seed: they hold their own state, so without a
   * remount a re-opened trim would be read once and then ignored.
   */
  const [recipeNonce, setRecipeNonce] = useState(0);
  /** The edit a re-opened master arrived with, seeding the trim panel. */
  const [seedEdit, setSeedEdit] = useState<MasterEdit | null>(null);
  /**
   * The re-opened source's duration, from the job that recorded it.
   *
   * Held separately because `reopenMaster` clears `job` — a re-open is a NEW
   * run, so presenting the old job's result would be wrong — and reading the
   * duration off `job` therefore always yielded 0. Without it the panel cannot
   * tell a saved "ends at 365" on a 365s source from a real tail trim, and
   * re-sends a redundant edit that costs a pre-pass copying the file for nothing.
   */
  const [seedDurationSec, setSeedDurationSec] = useState(0);
  /**
   * The full seam a re-opened master arrived with.
   *
   * The panel exposes only the overlap and Part B's head trim, but the API
   * accepts a richer recipe — a non-default curve, a tail trim or fades on Part
   * B. Rebuilding the seam from the two visible fields would silently discard
   * the rest and re-master a DIFFERENT song, so anything not on screen is
   * carried through untouched.
   *
   * Applied only while Part B is still the file it came from: swapping in
   * another Part B must not inherit the previous one's edit.
   */
  const [seedJoin, setSeedJoin] = useState<MasterJoin | null>(null);
  /** Where the web MP3 landed on the site's audio path, once staged. */
  const [published, setPublished] = useState<{ key: string; replaced: boolean } | null>(null);
  const [library, setLibrary] = useState<MasterJob[] | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** Which saved master is loaded in the library player, and its presigned URL. */
  const [playing, setPlaying] = useState<{ id: string; url: string; sourceUrl: string | null } | null>(null);
  /** Which row is being renamed, and the draft text. */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const libraryAudio = useRef<HTMLAudioElement | null>(null);

  const mounted = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Elapsed counter while the worker runs — silence with no clock reads as stuck.
  useEffect(() => {
    if (stage !== 'mastering') return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  /** Attach to a job (new or recovered) and follow it to a terminal state. */
  const watch = useCallback(async (id: string, stored: StoredJob) => {
    setJobId(id);
    setPaused(null);
    setStage('mastering');
    setElapsed(0);
    setAnnounce('Mastering started.');
    abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      const done = await pollJob<MasterJob>({
        // The status route returns the job flattened; pollJob's contract is
        // {status, result, error}. Reshape rather than duplicating its loop.
        fetchStatus: async (s) => {
          const r = await adminFetch(`/api/admin/music-lab/master/${id}`, { signal: s });
          if (!r.ok) return r;
          const j = (await r.json()) as MasterJob;
          return asResponse({ status: j.status, result: j, error: j.error });
        },
        signal,
        isMounted: () => mounted.current,
        intervalMs: 3000,
        timeoutMs: 16 * 60 * 1000, // the worker's own ceiling is 15 min
        timeoutMessage: `Still running after 16 minutes. The job keeps going server-side — reload this page to re-attach to it.`,
      });
      if (!mounted.current) return;
      if (!done) {
        // Superseded/aborted while still mounted: never strand the UI in
        // "mastering" with no control — fall back to a state with a way out.
        setStage(sourceKey || stored.sourceKey ? 'ready' : 'idle');
        return;
      }
      setJob(done);
      setStage('done');
      writeStored(null);
      setAnnounce(
        typeof done.afterLufs === 'number'
          ? `Mastering complete. Landed at ${done.afterLufs.toFixed(1)} LUFS.`
          : 'Mastering complete.'
      );
    } catch (err) {
      if (!mounted.current) return;
      // An abort landing mid-poll is a cancel, not a failed master — the job is
      // still running and still recoverable. stopWatching has already set the
      // stage and said so; don't overwrite that with a red alert.
      if (isAbort(err)) return;
      setError(err instanceof Error ? err.message : String(err));
      setStage('ready');
      setAnnounce('Mastering failed.');
    }
  }, [sourceKey]);

  // Re-attach to a job left running by a previous mount (navigation, reload,
  // session bounce). Without this the worker still writes the master to S3 and
  // the UI has no way to reach it.
  useEffect(() => {
    mounted.current = true;
    const stored = readStored();
    if (stored) {
      setSource({ name: stored.name, size: stored.size });
      setSourceKey(stored.sourceKey);
      setTarget(stored.target);
      if (stored.partBKey) {
        setPartB({ key: stored.partBKey, name: stored.partBName ?? 'Part B' });
        if (typeof stored.overlapSec === 'number') setOverlapSec(stored.overlapSec);
        if (typeof stored.partBStartSec === 'number') setPartBStartSec(stored.partBStartSec);
      }
      void watch(stored.jobId, stored);
    }
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
    // Mount-only: re-running this on `watch` identity change would re-attach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = useCallback(() => {
    abort.current?.abort();
    writeStored(null);
    setPaused(null);
    setStage('idle');
    setSource(null);
    setSourceKey(null);
    setSent({ loaded: 0, total: 0 });
    setJob(null);
    setJobId(null);
    setError(null);
    setAnnounce('');
    setSavedAt(null);
    setPublished(null);
    setPartB(null);
    setPartBUploading(false);
    setPartBStartSec(0);
    setSeedEdit(null);
    setSeedDurationSec(0);
    setSeedJoin(null);
    if (fileInput.current) fileInput.current.value = '';
  }, []);

  /**
   * Stop following, but leave the job running and recoverable. The stored job is
   * deliberately NOT cleared — it is what `resumeWatching` (and a reload)
   * re-attach to.
   */
  const stopWatching = useCallback(() => {
    abort.current?.abort();
    setPaused(readStored());
    setStage('ready');
    setAnnounce('Stopped watching. The master is still being produced.');
  }, []);

  /**
   * Re-attach to the job we stopped watching. Before this the only way back to a
   * running master was a full page reload — the copy even said so — which is a
   * poor answer when the job is one poll away from done.
   */
  const resumeWatching = useCallback(() => {
    const stored = paused ?? readStored();
    if (!stored) return;
    setPaused(null);
    setError(null);
    void watch(stored.jobId, stored);
  }, [paused, watch]);

  /**
   * Presign + PUT one WAV into the mastering workspace, returning its key.
   * Shared by Part A and Part B so a second source cannot drift onto a
   * different upload path (or skip the WAV guard).
   */
  const uploadToWorkspace = useCallback(async (
    file: File,
    onProgress: (loaded: number, total: number) => void,
    signal: AbortSignal,
    kind: 'audio' | 'cover' = 'audio',
  ): Promise<string> => {
    const typeOk = (ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(file.type);
    const res = await adminFetch('/api/admin/mastering/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        // A cover's own type is sent through: the server pins it into the S3
        // policy, so an image cannot masquerade as audio/wav.
        contentType: kind === 'cover' ? file.type : typeOk ? file.type : 'audio/wav',
        size: file.size,
        ...(kind === 'cover' ? { kind } : {}),
      }),
      signal,
    });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(body.error || `Could not start the upload (HTTP ${res.status}).`);
    await putToS3(body.uploadUrl, body.fields, file, onProgress, signal);
    return body.key as string;
  }, []);

  /**
   * Part B of a two-part assembly. Same WAV-only rule as Part A: an MP3 here is
   * worse than usual, because encoder padding adds silent frames at the head and
   * tail that misalign the overlap.
   */
  const onPickPartB = useCallback(async (file: File) => {
    setError(null);
    const extOk = /\.wave?$/i.test(file.name);
    const typeOk = (ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(file.type);
    if (!typeOk && !extOk) {
      setError('Part B must be a WAV. MP3 padding adds silent frames that misalign the crossfade.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`Part B is ${MB(file.size)}, over the ${MB(MAX_UPLOAD_BYTES)} limit.`);
      return;
    }
    setPartBUploading(true);
    setPartBSent({ loaded: 0, total: file.size });
    const controller = new AbortController();
    try {
      const key = await uploadToWorkspace(
        file,
        (loaded, total) => mounted.current && setPartBSent({ loaded, total }),
        controller.signal,
      );
      if (!mounted.current) return;
      setPartB({ key, name: file.name });
      // A new Part B must not inherit the previous seam's edit.
      setSeedJoin(null);
      setAnnounce('Part B uploaded.');
    } catch (err) {
      if (!mounted.current) return;
      if (!isAbort(err)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setPartBUploading(false);
    }
  }, [uploadToWorkspace]);

  const onPick = useCallback(async (picked: File | null) => {
    if (!picked) return;
    setError(null);
    setJob(null);
    // Allow re-picking the same path after a rejection (no change event otherwise).
    if (fileInput.current) fileInput.current.value = '';

    const extOk = /\.wave?$/i.test(picked.name);
    const typeOk = (ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(picked.type);
    if (!typeOk && !extOk) {
      setError('That is not a WAV. Export the lossless WAV from SUNO — mastering an MP3 only re-levels a file that has already lost detail.');
      return;
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setError(`That file is ${MB(picked.size)}, over the ${MB(MAX_UPLOAD_BYTES)} limit.`);
      return;
    }

    setSource({ name: picked.name, size: picked.size });
    setPickedFile(picked);
    setEdit(null);
    // …and the join. `edit` was already cleared here because a trim placed on
    // one song is meaningless on the next; a Part B is worse, because it would
    // silently crossfade an unrelated section onto the new source and master
    // cleanly while doing it.
    setPartB(null);
    setPartBStartSec(0);
    setSeedEdit(null);
    setSeedDurationSec(0);
    setSeedJoin(null);
    setRecipeNonce((n) => n + 1);
    setStage('uploading');
    setSent({ loaded: 0, total: picked.size });
    setAnnounce(`Uploading ${picked.name}.`);
    abort.current = new AbortController();

    try {
      const res = await adminFetch('/api/admin/mastering/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: picked.name,
          // Trust our own extension check over a browser MIME guess: some
          // systems report audio/vnd.wave etc., which the API allow-list rejects.
          contentType: typeOk ? picked.type : 'audio/wav',
          size: picked.size,
        }),
        signal: abort.current.signal,
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `Could not start the upload (HTTP ${res.status}).`);

      await putToS3(
        body.uploadUrl, body.fields, picked,
        (loaded, total) => mounted.current && setSent({ loaded, total }),
        abort.current.signal
      );
      if (!mounted.current) return;
      setSourceKey(body.key);
      setStage('ready');
      setAnnounce('Upload complete. Ready to master.');
    } catch (err) {
      if (!mounted.current) return;
      // "Cancel upload" already reset the UI to idle; surfacing its own abort as
      // an error banner told the admin something had gone wrong when they had
      // simply changed their mind.
      if (isAbort(err)) {
        setAnnounce('Upload cancelled.');
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setStage('idle');
      setSource(null);
    }
  }, []);

  const startMastering = useCallback(async () => {
    if (!sourceKey || !source) return;
    setError(null);
    setJob(null);
    // Per-job state, not per-session. `savedAt` was set on the first save and
    // never cleared, so mastering a SECOND file in the same visit met a
    // disabled "Saved to library" button belonging to the previous job — the
    // new master could not be saved at all without a page reload.
    setSavedAt(null);
    setPublished(null);
    try {
      const res = await adminFetch('/api/admin/music-lab/master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `edit` is omitted entirely when null, so a plain run sends the exact
        // body it always did.
        // `edit` and `join` are omitted entirely when unused, so a plain run
        // sends the exact body it always did.
        body: JSON.stringify({
          s3Key: sourceKey,
          target,
          ...(edit ? { edit } : {}),
          ...(partB
            ? {
                join: buildJoinPayload({
                  partBKey: partB.key,
                  overlapSec,
                  partBStartSec,
                  // Only the seam this Part B actually came from.
                  seed: seedJoin?.partBKey === partB.key ? seedJoin : null,
                }),
              }
            : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `Could not start mastering (HTTP ${res.status}).`);
      const stored: StoredJob = {
        jobId: body.jobId, sourceKey, name: source.name, size: source.size, target,
        ...(partB ? { partBKey: partB.key, partBName: partB.name, overlapSec, partBStartSec } : {}),
      };
      writeStored(stored);
      await watch(body.jobId, stored);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setStage('ready');
    }
  }, [sourceKey, source, target, edit, partB, overlapSec, partBStartSec, seedJoin, watch]);

  /**
   * Presign + open one workspace WAV. Shared by the result panel and the saved
   * library so both get the same friendly filename and the same auth — the
   * route replies with JSON, not a redirect, so a plain <a href> would render
   * the JSON instead of downloading, and would carry no bearer token.
   */
  const downloadKey = useCallback(async (key: string, title: string, targetLufs: number) => {
    setError(null);
    try {
      // Present a friendly filename ("<title> (Master -14 LUFS).wav") when the
      // admin has named the master; the server sanitises it. Storage key is
      // untouched. No name ⇒ the route falls back to a de-noised default.
      const nameParam = title ? `&name=${encodeURIComponent(`${title} (Master ${targetLufs} LUFS)`)}` : '';
      const res = await adminFetch(
        `/api/admin/mastering/download?key=${encodeURIComponent(key)}${nameParam}`
      );
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not create the download link.');
      // A new tab, not window.location — the response is Content-Disposition:
      // attachment, but a failed/expired presign would otherwise replace this
      // page with an S3 error document and destroy the result panel.
      window.open(body.url, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const download = useCallback(() => {
    if (!job?.masterKey) return;
    void downloadKey(job.masterKey, masterName.trim(), job.target);
  }, [job, masterName, downloadKey]);

  /** The 192k web MP3 — what the site serves, built from the master above. */
  const downloadMp3 = useCallback(() => {
    if (!job?.mp3Key) return;
    void downloadKey(job.mp3Key, masterName.trim(), job.target);
  }, [job, masterName, downloadKey]);

  /**
   * Is the delivered MP3 peak-safe? This is the only check anywhere on the file
   * listeners actually receive — the catalogue sweep found two served MP3s over
   * the ceiling that no earlier step would have caught.
   */
  const mp3Verdict = job?.mp3Key
    ? mp3PeakVerdict({ mp3Tp: job.mp3Tp, wavTp: job.afterTp })
    : null;

  /** Save the loudness summary as a text file that travels with the WAV. */
  /**
   * Keep this master. Unsaved jobs expire after 24h — the WAV survives in S3 but
   * the record explaining it does not, leaving an orphaned machine-named file.
   */
  const loadLibrary = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/music-lab/masters');
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) setLibrary(body.masters as MasterJob[]);
    } catch {
      // A library that fails to load must never block mastering — the list is
      // supplementary, the job in front of the user is the point.
    }
  }, []);

  const saveToLibrary = useCallback(async () => {
    if (!jobId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/music-lab/master/${jobId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: masterName.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not save this master.');
      setSavedAt(new Date().toISOString());
      setAnnounce('Master saved to the library.');
      setLibraryOpen(true);
      void loadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [jobId, masterName, loadLibrary]);


  /**
   * Stage the web MP3 at the site's own audio path.
   *
   * The destination is canonical per song and CDN-served, so an occupied key
   * comes back as a 409 conflict rather than being replaced — the admin is the
   * only one who knows whether the file already there is the same song. Only an
   * explicit confirm retries with `overwrite`.
   */
  const publishToSite = useCallback(async (overwrite = false) => {
    if (!jobId) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/music-lab/master/${jobId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overwrite ? { overwrite: true } : {}),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 409 && body.conflict) {
        // Ask before replacing what the site currently serves. The bucket is
        // versioned, so a confirmed overwrite is recoverable — but it is still
        // a change to a live song, and must be chosen rather than defaulted.
        if (window.confirm(`${body.error}\n\nReplace it?`)) {
          await publishToSite(true);
        }
        return;
      }
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not publish this master.');

      setPublished({ key: body.key as string, replaced: Boolean(body.replaced) });
      setAnnounce(body.replaced ? 'Web MP3 replaced on the site path.' : 'Web MP3 staged on the site path.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }, [jobId]);

  /** Cover art for the render. Same workspace, same guards, image allow-list. */
  const onPickCover = useCallback(async (file: File) => {
    setError(null);
    setCoverUploading(true);
    const controller = new AbortController();
    try {
      const key = await uploadToWorkspace(file, () => {}, controller.signal, 'cover');
      if (!mounted.current) return;
      setCover({ key, name: file.name });
      setAnnounce('Cover uploaded.');
    } catch (err) {
      if (!mounted.current) return;
      if (!isAbort(err)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setCoverUploading(false);
    }
  }, [uploadToWorkspace]);

  /**
   * Render the upload-ready MP4 and wait for it.
   *
   * The encode runs in the worker, so this polls the same status route the
   * mastering flow does until `videoKey` (or `videoError`) appears. Bounded:
   * a render that has not landed in ten minutes is reported rather than spun on
   * forever, and the job keeps the result either way.
   */
  const renderVideo = useCallback(async () => {
    if (!jobId || !cover) return;
    setRendering(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/music-lab/master/${jobId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverKey: cover.key, height: videoHeight }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not start the render.');
      setAnnounce('Rendering the video.');

      // Check IMMEDIATELY, then settle into an interval. A short render can be
      // finished before the first tick would have elapsed, and waiting anyway
      // would show a spinner for a file that already exists.
      const deadline = Date.now() + 10 * 60 * 1000;
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 4000));
        if (!mounted.current) return;
        const s = await adminFetch(`/api/admin/music-lab/master/${jobId}`);
        const fresh = (await s.json()) as MasterJob;
        if (fresh.videoKey) {
          setJob(fresh);
          setAnnounce('Video ready.');
          return;
        }
        if (fresh.videoError) throw new Error(fresh.videoError);
        if (Date.now() > deadline) {
          throw new Error('The render is taking longer than expected — reload to check on it.');
        }
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setRendering(false);
    }
  }, [jobId, cover, videoHeight]);

  /**
   * Deliberately NOT loaded on mount: listing scans the table, and most visits
   * to this page are to master a file, not to browse history. Load on first
   * open, and after a save (which is when the list has actually changed).
   */
  /**
   * Audition a saved master in place.
   *
   * The bucket is private, so this mints a presigned URL via the SAME download
   * route the compare player uses — `mode=play` deliberately omits the
   * Content-Disposition filename so the browser streams it instead of
   * downloading. The URL lasts an hour, long enough to seek around a full song.
   */
  const playSaved = useCallback(async (m: MasterJob) => {
    if (!m.masterKey) return;
    if (playing?.id === m.id) {
      // Same row again = stop. Releasing the src also stops the network fetch.
      libraryAudio.current?.pause();
      setPlaying(null);
      return;
    }
    setRowBusy(m.id);
    setError(null);
    try {
      const res = await adminFetch(
        `/api/admin/mastering/download?key=${encodeURIComponent(m.masterKey)}&mode=play`
      );
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not open that master.');
      // The unmastered take, for A/B. Optional: an older job may not have a
      // reachable source, and a missing comparison must not block playback.
      let sourceUrl: string | null = null;
      if (m.s3Key) {
        try {
          const sr = await adminFetch(
            `/api/admin/mastering/download?key=${encodeURIComponent(m.s3Key)}&mode=play`
          );
          const sb = await sr.json();
          if (sr.ok && sb.success) sourceUrl = sb.url as string;
        } catch {
          /* A/B simply stays unavailable. */
        }
      }
      setPlaying({ id: m.id, url: body.url as string, sourceUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRowBusy(null);
    }
  }, [playing]);

  /**
   * Commit a rename. The server sanitises the title (it also drives the
   * download filename) and returns the cleaned value, so the row is updated
   * from the RESPONSE rather than from what was typed — otherwise the list
   * would show a name the file will never have.
   */
  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const { id, value } = renaming;
    const next = value.trim();
    if (!next) { setRenaming(null); return; }
    // Enter commits, and the input then unmounts — which can also fire onBlur
    // with the pre-commit closure still holding `renaming`. Without this the
    // same rename is PATCHed twice.
    if (rowBusy === id) return;
    // Closing an editor without changing anything must not cost a write.
    if (next === (library?.find((x) => x.id === id)?.title ?? '')) {
      setRenaming(null);
      return;
    }
    setRowBusy(id);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/music-lab/master/${id}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not rename that master.');
      setLibrary((prev) =>
        prev ? prev.map((x) => (x.id === id ? { ...x, title: body.title as string } : x)) : prev
      );
      setRenaming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRowBusy(null);
    }
  }, [renaming, rowBusy, library]);

  /**
   * Re-open a saved master for another pass.
   *
   * The point of the module's ordering is that an edit is a RECIPE over an
   * untouched source, so a saved job already carries everything needed to run
   * again: the source key, the trim, the seam. Before this, coming back the next
   * day meant re-uploading the WAV to change a fade by half a second.
   *
   * This deliberately does NOT re-run anything. It restores the recipe and
   * hands control back at the "ready" stage, so the admin adjusts and presses
   * Master — the same path a fresh upload takes, and the same validation.
   */
  const reopenMaster = useCallback((m: MasterJob) => {
    if (!m.s3Key) return;
    abort.current?.abort();
    setError(null);
    setJob(null);
    setJobId(null);
    // A re-opened master is a NEW job: it has not been saved or published, and
    // showing yesterday's state against it would offer to publish a file this
    // run has not produced.
    setSavedAt(null);
    setPublished(null);
    setCover(null);

    setSourceKey(m.s3Key);
    // Name only — the File itself cannot survive, so the trim panel falls back
    // to numeric entry, which is exactly what it does after any remount.
    setSource({ name: downloadFilename(m.s3Key), size: 0 });
    setPickedFile(null);
    setTarget(m.target);
    setMasterName(m.title ?? '');
    setEdit(m.edit);
    setSeedEdit(m.edit);
    setSeedDurationSec(m.source?.durationSec ?? 0);

    if (m.join) {
      setPartB({ key: m.join.partBKey, name: downloadFilename(m.join.partBKey) });
      setOverlapSec(m.join.overlapSec);
      setPartBStartSec(m.join.editB?.trimStartSec ?? 0);
      setSeedJoin(m.join);
    } else {
      setPartB(null);
      setPartBStartSec(0);
      setSeedJoin(null);
    }
    // A stopped-watch affordance from a previous job would otherwise sit over
    // this one, offering to resume something unrelated.
    setPaused(null);

    setRecipeNonce((n) => n + 1);
    setStage('ready');
    setLibraryOpen(false);
    setAnnounce(`Re-opened ${m.title ?? 'master'}. Adjust and master again.`);
  }, []);

  const toggleLibrary = useCallback(() => {
    setLibraryOpen((open) => {
      if (!open && library === null) void loadLibrary();
      return !open;
    });
  }, [library, loadLibrary]);


  const downloadReport = useCallback(() => {
    if (!job?.masterKey) return;
    const blob = new Blob([buildMasterReport(job, masterName)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFilename(masterName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [job, masterName]);

  /** Selecting a different target after a run re-arms rather than dead-ending. */
  const pickTarget = useCallback((lufsValue: number) => {
    setTarget(lufsValue);
    setStage((s) => (s === 'done' ? 'ready' : s));
    setJob((j) => (j && j.target !== lufsValue ? null : j));
  }, []);

  // Verdict. Tolerance is the repo's 1 LU (loudness-targets), not a hair-fine
  // 0.1 — two-pass loudnorm lands within a few tenths and a good master must
  // not be flagged. `afterLufs` can legitimately be null (the worker's
  // measurement pass failed on a master that is otherwise fine), which is a
  // third state, not a failure.
  const verdict: 'on-target' | 'off-target' | 'unmeasured' =
    typeof job?.afterLufs !== 'number'
      ? 'unmeasured'
      : statusFor(job.afterLufs - job.target) === 'ok'
        ? 'on-target'
        : 'off-target';
  const readiness = job ? streamingReadiness(job) : { ok: false, headline: '', facts: '', checks: [] };
  const movedLu =
    typeof job?.beforeLufs === 'number' && typeof job?.afterLufs === 'number'
      ? Math.abs(job.afterLufs - job.beforeLufs)
      : null;

  const pct = sent.total ? Math.round((sent.loaded / sent.total) * 100) : 0;
  const busy = stage === 'uploading' || stage === 'mastering';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <SlidersHorizontal className="h-6 w-6 text-orange-600" aria-hidden="true" />
          Sound Engineering &amp; Mastering
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
          Export the WAV from SUNO, master it to a streaming target here, then take the mastered WAV into Adobe.
          This is <strong>loudness</strong> mastering — level and true-peak only, never EQ, compression or tone.
        </p>
      </header>

      {/* Announced to screen readers at every stage change. */}
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* 1 — source */}
      <section aria-busy={stage === 'uploading'} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          1 · Source WAV from SUNO
        </h2>

        {stage === 'idle' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              // Without this the browser navigates the tab to the dropped file —
              // the most natural gesture on a dashed box was the worst outcome.
              e.preventDefault();
              setDragging(false);
              void onPick(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <input
              ref={fileInput}
              id={inputId}
              type="file"
              accept=".wav,audio/wav,audio/x-wav"
              className="peer sr-only"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
            <label
              htmlFor={inputId}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition peer-focus-visible:ring-2 peer-focus-visible:ring-orange-500 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-gray-900 ${
                dragging
                  ? 'border-orange-500 bg-orange-50/60 dark:border-orange-500 dark:bg-orange-500/10'
                  : 'border-gray-300 hover:border-orange-400 hover:bg-orange-50/40 dark:border-gray-700 dark:hover:border-orange-500 dark:hover:bg-orange-500/5'
              }`}
            >
              <Upload className="h-6 w-6 text-gray-400" aria-hidden="true" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Drop a WAV here, or click to choose
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                WAV only · up to {MB(MAX_UPLOAD_BYTES)} · uploads straight to S3
              </span>
            </label>
          </div>
        )}

        {stage === 'uploading' && source && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span className="truncate">Uploading {source.name}</span>
              <span className="ml-auto shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
                {MB(sent.loaded)} / {MB(sent.total)} · {pct}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
              className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
            >
              <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <X className="h-3 w-3" aria-hidden="true" /> Cancel upload
            </button>
          </div>
        )}

        {(stage === 'ready' || stage === 'mastering' || stage === 'done') && source && (
          <div className="flex items-center gap-3 text-sm">
            <FileAudio className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-900 dark:text-gray-100">{source.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {source.size > 0 ? `${MB(source.size)} · uploaded` : 'from the library · source unchanged'}
              </p>
            </div>
            {stage !== 'mastering' && (
              <button
                type="button"
                onClick={reset}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" /> Start over
              </button>
            )}
          </div>
        )}
      </section>

      {/* 2 — target + run */}
      <section aria-busy={stage === 'mastering'} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          2 · Target &amp; master
        </h2>

        <div role="radiogroup" aria-label="Streaming loudness target" className="flex flex-wrap gap-2">
          {TARGETS.map((t) => (
            <button
              key={t.lufs}
              type="button"
              role="radio"
              aria-checked={target === t.lufs}
              disabled={stage === 'mastering'}
              onClick={() => pickTarget(t.lufs)}
              className={`flex items-start gap-2 rounded-lg border px-4 py-2 text-left transition disabled:opacity-50 ${
                target === t.lufs
                  ? 'border-orange-500 bg-orange-50 dark:border-orange-500 dark:bg-orange-500/10'
                  : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
              }`}
            >
              <CheckCircle2
                className={`mt-0.5 h-4 w-4 shrink-0 ${target === t.lufs ? 'text-orange-600' : 'text-transparent'}`}
                aria-hidden="true"
              />
              <span>
                <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{t.label}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{t.for}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Each target writes its own file, so you can master the same song for both without one overwriting the other.
        </p>

        {sourceKey && (
          <div className="mt-4">
            {/*
              Mounted for as long as a source is loaded — including while the
              worker runs. Unmounting it mid-run would tear down its region and
              fade state, and its remount would push `null` back up, so the
              second target in the dual-target flow would quietly master the
              UNTRIMMED file. Disabled rather than removed.
            */}
            <MasteringTrimPanel
              key={`trim-${recipeNonce}`}
              file={pickedFile}
              onChange={setEdit}
              disabled={stage === 'mastering'}
              initialEdit={seedEdit}
              knownDurationSec={seedDurationSec}
            />

            {/* Both panels edit the SAME pre-pass, upstream of every
                measurement — which is what makes "master the assembled song
                once" the only available order. */}
            <MasteringJoinPanel
              key={`join-${recipeNonce}`}
              partB={partB}
              onPick={(f) => void onPickPartB(f)}
              onClear={() => { setPartB(null); setPartBStartSec(0); setSeedJoin(null); }}
              overlapSec={overlapSec}
              onOverlapChange={setOverlapSec}
              partBStartSec={partBStartSec}
              onPartBStartChange={setPartBStartSec}
              uploading={partBUploading}
              progressPct={partBSent.total ? Math.round((partBSent.loaded / partBSent.total) * 100) : 0}
              disabled={stage === 'mastering'}
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={startMastering}
            disabled={!(stage === 'ready' || stage === 'done')}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stage === 'mastering'
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
            {stage === 'mastering' ? `Mastering… ${elapsed}s` : `Master to ${target} LUFS`}
          </button>
          {stage === 'mastering' && (
            <button
              type="button"
              onClick={stopWatching}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <X className="h-3 w-3" aria-hidden="true" /> Stop watching
            </button>
          )}
          {stage === 'idle' && (
            <span className="text-xs text-gray-500 dark:text-gray-400">Upload a WAV first.</span>
          )}
          {stage === 'ready' && paused && (
            <button
              type="button"
              onClick={resumeWatching}
              className="inline-flex items-center gap-1 rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-800 hover:bg-orange-100 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300 dark:hover:bg-orange-500/20"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" /> Resume watching job{' '}
              <code>{paused.jobId.slice(0, 8)}</code>
            </button>
          )}
        </div>
        {stage === 'ready' && paused && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            That master is still being produced. Resume to pick it up where it is — mastering again would start a
            second, duplicate job.
          </p>
        )}
        {stage === 'mastering' && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Two-pass loudnorm — measure, then correct. Usually well under a minute; long sources take a few.
            This keeps running if you leave the page, and re-attaches when you come back.
            {jobId && <> Job <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">{jobId.slice(0, 8)}</code>.</>}
          </p>
        )}
      </section>

      {/* 3 — result + hand-off */}
      {stage === 'done' && job && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            3 · Result
            {readiness.ok && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
          </h2>

          {/* One glanceable verdict, driven by the SAME rules as the saved .txt
              report so the screen and the file cannot disagree. Requires all
              three: on target, peak-safe, dynamics preserved. */}
          <div
            className={`mb-3 rounded-lg border p-3 text-sm ${
              readiness.ok
                ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-900/10'
                : 'border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-900/10'
            }`}
          >
            <p className={`font-semibold ${readiness.ok ? 'text-emerald-800 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300'}`}>
              {readiness.ok ? '✓' : '⚠'} {readiness.headline}
            </p>
            <p className="mt-0.5 tabular-nums text-gray-700 dark:text-gray-200">{readiness.facts}</p>

            <dl className="mt-2 grid gap-x-4 gap-y-1 border-t border-black/5 pt-2 text-xs dark:border-white/10 sm:grid-cols-2">
              {readiness.checks.map((c) => (
                <div key={c.label} className="flex items-baseline gap-1.5">
                  <span
                    aria-hidden="true"
                    className={
                      c.ok === true
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : c.ok === false
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-gray-400'
                    }
                  >
                    {c.ok === true ? '✓' : c.ok === false ? '✗' : '·'}
                  </span>
                  <dt className="font-medium text-gray-700 dark:text-gray-200">{c.label}</dt>
                  <dd className="tabular-nums text-gray-500 dark:text-gray-400">{c.detail}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">Stage</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Integrated</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">True peak</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Range (LRA)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-800 dark:divide-gray-800 dark:text-gray-200">
                <tr>
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    Source
                    {sourceInfoLine(job) && (
                      <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                        {sourceInfoLine(job)}
                      </span>
                    )}
                  </th>
                  <td className="px-4 py-2 text-right tabular-nums">{lufs(job.beforeLufs)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{dbtp(job.beforeTp)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{lu(job.beforeLra)}</td>
                </tr>
                <tr className="bg-emerald-50/40 dark:bg-emerald-500/5">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    Streaming Master
                    <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                      24-bit · 48 kHz
                    </span>
                  </th>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{lufs(job.afterLufs)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{dbtp(job.afterTp)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {lu(job.afterLra)}
                    {dynamicsPreserved(job) && (
                      <span className="ml-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                        unchanged
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {joinLine(job) && (
            <p className="mt-3 flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
              <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {/* Same string as the saved .txt — otherwise a master whose length
                  nobody can account for is explained on screen and nowhere else. */}
              <span>{joinLine(job)}</span>
            </p>
          )}

          <p className="mt-3 flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              <strong>Integrated</strong> is how loud the song plays overall — the number platforms normalise to.
              <strong> True peak</strong> is how close the loudest instant comes to distortion; at or under -1 dBTP is safe.
            </span>
          </p>

          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
            {verdict === 'on-target' && `Landed on ${job.target} LUFS, peak-safe.`}
            {verdict === 'off-target' &&
              `Measured ${lufs(job.afterLufs)} against a ${job.target} LUFS target — worth a listen before you use it.`}
            {verdict === 'unmeasured' &&
              `The master was written, but the check measurement did not come back — download it and verify before use.`}
            {verdict === 'on-target' && movedLu !== null && movedLu < 1 && (
              <span className="text-gray-500 dark:text-gray-400">
                {' '}The source moved {movedLu.toFixed(2)} LU — below what anyone can hear, which is the correct
                outcome for a song that was already on target.
              </span>
            )}
          </p>

          {typeof job.afterLufs === 'number' && (
            <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
              <p className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-300">
                Streaming readiness — how it lands on each platform
              </p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {platformLanding(job.afterLufs).map((row) => (
                    <tr key={row.target}>
                      <td
                        className={`w-6 pl-4 text-center font-semibold ${
                          row.status === 'ok'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                        aria-hidden="true"
                      >
                        {row.mark}
                      </td>
                      <td className="py-2 pl-2 tabular-nums text-gray-500 dark:text-gray-400">{row.target} LUFS</td>
                      <td className="px-4 py-2 text-gray-800 dark:text-gray-200">{row.platforms.join(', ')}</td>
                      <td
                        className={`px-4 py-2 text-right ${
                          row.status === 'ok'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {row.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {job.masterKey && job.s3Key && (
            <MasteringComparePlayer
              sourceKey={job.s3Key}
              masterKey={job.masterKey}
              beforeLufs={job.beforeLufs}
              afterLufs={job.afterLufs}
            />
          )}

          <div className="mt-4">
            <label htmlFor={`${inputId}-name`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
              Name this master <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              id={`${inputId}-name`}
              type="text"
              value={masterName}
              onChange={(e) => setMasterName(e.target.value)}
              placeholder="e.g. Amma En Agame"
              maxLength={120}
              className="mt-1 w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {masterName.trim()
                ? `Downloads as “${masterName.trim()} (Master ${job.target} LUFS).wav”. Tamil names work too.`
                : 'Used only for the download filename and report — the stored file keeps its unique id.'}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={download}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              <Download className="h-4 w-4" aria-hidden="true" /> Download for Adobe
            </button>
            {job.mp3Key && (
              <button
                type="button"
                onClick={downloadMp3}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Download web MP3
              </button>
            )}
            <button
              type="button"
              onClick={downloadReport}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <FileAudio className="h-4 w-4" aria-hidden="true" /> Download report
            </button>
            {mp3Verdict && (
              <p
                className={`basis-full text-xs ${
                  mp3Verdict.status === 'hot'
                    ? 'font-medium text-red-600 dark:text-red-400'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {mp3Verdict.status === 'hot' && (
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                )}
                {mp3Verdict.message}
                {mp3Verdict.encodeDeltaDb !== null && (
                  <> Encoding moved the peak by {mp3Verdict.encodeDeltaDb >= 0 ? '+' : ''}
                    {mp3Verdict.encodeDeltaDb.toFixed(2)} dB.</>
                )}
              </p>
            )}
            <button
              type="button"
              onClick={saveToLibrary}
              disabled={saving || !!savedAt}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
            >
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Save className="h-4 w-4" aria-hidden="true" />}
              {savedAt ? 'Saved to library' : 'Save to library'}
            </button>
          </div>
          {!savedAt && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Unsaved masters are cleared after 24 hours. The WAV stays in S3, but the loudness
              report and A/B comparison are lost with the record.
            </p>
          )}

          {/* Publish — only once saved, because the title IS the filename and
              save is what persists it. Deliberately a separate step from Save:
              this writes to the CDN-served path the site reads. */}
          {savedAt && job.mp3Key && (
            <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void publishToSite()}
                  disabled={publishing || !!published}
                  className="inline-flex items-center gap-2 rounded-lg border border-orange-300 px-4 py-2 text-sm font-medium text-orange-700 transition hover:bg-orange-50 disabled:opacity-60 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-900/20"
                >
                  {publishing
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Upload className="h-4 w-4" aria-hidden="true" />}
                  {published ? 'Staged on the site path' : 'Publish web MP3 to site'}
                </button>
                {published && (
                  <code className="min-w-0 truncate rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                    {published.key}
                  </code>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {published ? (
                  <>
                    {published.replaced
                      ? 'Replaced the file that was already there (the bucket is versioned, so the previous one still exists). '
                      : 'Copied into the site’s audio folder. '}
                    <strong>Not live yet</strong> — the song appears on tamilagaval.com once a content
                    record points at this file and the site rebuilds.
                  </>
                ) : (
                  <>
                    Copies the measured MP3 to <code>audio/poem-music/</code> under this master’s name,
                    so it no longer has to be downloaded and re-uploaded by hand. Staging only — the song
                    goes live when a content record points at it and the site rebuilds.
                  </>
                )}
              </p>
            </div>
          )}

          {/* Render for YouTube — cover art over the MASTERED audio, encoded
              once. This is what keeps Premiere out of the audio path: no
              re-export, so nothing can re-level or re-encode the master before
              YouTube receives it. */}
          {savedAt && job.masterKey && (
            <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <Film className="h-3.5 w-3.5" aria-hidden="true" /> Render for YouTube
              </h3>

              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor={`${inputId}-cover`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    Cover image
                  </label>
                  <input
                    id={`${inputId}-cover`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={rendering || coverUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void onPickCover(f);
                    }}
                    className="mt-1 block w-full max-w-xs text-xs text-gray-600 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 dark:text-gray-300 dark:file:border-gray-700 dark:file:bg-gray-900 dark:file:text-gray-200"
                  />
                </div>
                <div>
                  <label htmlFor={`${inputId}-height`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    Upload size
                  </label>
                  <select
                    id={`${inputId}-height`}
                    value={videoHeight}
                    disabled={rendering}
                    onChange={(e) => setVideoHeight(Number(e.target.value))}
                    className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  >
                    <option value={1080}>1080p</option>
                    <option value={1440}>1440p — better audio on YouTube</option>
                    <option value={2160}>2160p</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => void renderVideo()}
                  disabled={!cover || rendering || coverUploading}
                  className="inline-flex items-center gap-2 rounded-lg border border-orange-300 px-4 py-2 text-sm font-medium text-orange-700 transition hover:bg-orange-50 disabled:opacity-60 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-900/20"
                >
                  {rendering
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Film className="h-4 w-4" aria-hidden="true" />}
                  {rendering ? 'Rendering…' : 'Render video'}
                </button>
                {job.videoKey && (
                  <button
                    type="button"
                    onClick={() => void downloadKey(job.videoKey!, masterName.trim(), job.target)}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" /> Download MP4
                  </button>
                )}
              </div>

              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {coverUploading
                  ? 'Uploading cover…'
                  : cover
                    ? `Cover: ${cover.name}. `
                    : 'Add a cover to render. '}
                Encodes the <strong>mastered WAV</strong> at AAC 384k/48&nbsp;kHz — the audio never
                passes through another editor, so nothing can re-level it. 1440p is the default
                because YouTube gives higher-resolution uploads a better audio codec.
                {job.videoKey && ' Upload the MP4 to YouTube as-is.'}
              </p>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm dark:border-amber-900/40 dark:bg-amber-900/10">
            <p className="font-semibold text-amber-800 dark:text-amber-300">Hand-off to Adobe — master once</p>
            <p className="mt-1 text-gray-700 dark:text-gray-200">
              Import this WAV as the audio track and pass it through untouched at 48 kHz. If Essential Sound&rsquo;s
              &ldquo;Auto-Match&rdquo; is on, or the export adds gain, it re-processes the audio and cancels the master
              you just made. Export with PCM or high-bitrate AAC and <strong>no loudness normalisation</strong>.
            </p>
          </div>
        </section>
      )}


      <section className="mt-8">
        <button
          type="button"
          onClick={toggleLibrary}
          aria-expanded={libraryOpen}
          className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <Library className="h-4 w-4" aria-hidden="true" />
          Saved masters
          {library && <span className="font-normal normal-case tracking-normal">({library.length})</span>}
        </button>

        {libraryOpen && library && library.length === 0 && (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            No saved masters yet. Master a file and choose <strong>Save to library</strong> to keep it.
          </p>
        )}

        {libraryOpen && library && library.length > 0 && (
          <ul className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {library.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                {m.masterKey && (
                  <button
                    type="button"
                    onClick={() => void playSaved(m)}
                    disabled={rowBusy === m.id}
                    aria-label={playing?.id === m.id ? `Stop ${m.title ?? 'master'}` : `Play ${m.title ?? 'master'}`}
                    className="shrink-0 rounded-full border border-gray-300 p-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    {rowBusy === m.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : playing?.id === m.id ? (
                      <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                )}
                {renaming?.id === m.id ? (
                  <input
                    value={renaming.value}
                    autoFocus
                    aria-label="Master name"
                    maxLength={120}
                    onChange={(e) => setRenaming({ id: m.id, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={() => void commitRename()}
                    className="min-w-0 grow rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
                  />
                ) : (
                  <span className="flex min-w-0 grow items-center gap-1.5">
                    <span className="min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
                      {m.title || <span className="text-gray-500 dark:text-gray-400">(untitled)</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRenaming({ id: m.id, value: m.title ?? '' })}
                      aria-label={`Rename ${m.title ?? 'master'}`}
                      className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                )}
                <span className="tabular-nums text-xs text-gray-500 dark:text-gray-400">
                  {(m.savedAt ?? '').slice(0, 10)}
                </span>
                <span className="tabular-nums text-xs text-gray-600 dark:text-gray-300">
                  {lufs(m.afterLufs)}
                </span>
                <span className="tabular-nums text-xs text-gray-600 dark:text-gray-300">
                  LRA {lu(m.beforeLra)} → {lu(m.afterLra)}
                  {dynamicsPreserved(m) && (
                    <span className="ml-1 text-emerald-600 dark:text-emerald-400">unchanged</span>
                  )}
                </span>
                {m.publishedAt && (
                  <span
                    title={m.publishKey ?? undefined}
                    className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                  >
                    On site
                  </span>
                )}
                {m.masterKey && (
                  <button
                    type="button"
                    onClick={() => void downloadKey(m.masterKey!, m.title ?? '', m.target)}
                    className="text-xs font-medium text-orange-600 hover:underline dark:text-orange-400"
                  >
                    WAV
                  </button>
                )}
                {/* The MP3 was reachable only from the result panel of the run
                    that produced it — so a master saved yesterday had a web
                    file in S3 that nothing on this page could open. */}
                {m.mp3Key && (
                  <button
                    type="button"
                    onClick={() => void downloadKey(m.mp3Key!, m.title ?? '', m.target)}
                    className="text-xs font-medium text-orange-600 hover:underline dark:text-orange-400"
                  >
                    MP3
                  </button>
                )}
                {/* The source is never modified, so re-opening costs nothing and
                    loses nothing — it restores the recipe and hands back
                    control at the "ready" stage. */}
                {m.s3Key && (
                  <button
                    type="button"
                    onClick={() => reopenMaster(m)}
                    className="text-xs font-medium text-orange-600 hover:underline dark:text-orange-400"
                  >
                    Edit &amp; re-master
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {libraryOpen && playing && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/40">
            {/* Key on the URL so swapping rows reloads the element rather than
                leaving the previous song's buffer playing. */}
            <MasteringPlayer
              key={playing.url}
              masterUrl={playing.url}
              sourceUrl={playing.sourceUrl}
              title={library?.find((x) => x.id === playing.id)?.title || 'Master'}
              afterTp={library?.find((x) => x.id === playing.id)?.afterTp ?? null}
              onExpired={() => {
                setError('That playback link expired — press play again to get a fresh one.');
                setPlaying(null);
              }}
            />
          </div>
        )}
      </section>

      {busy && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Leaving this page will not stop the work — it re-attaches when you return.
        </p>
      )}
    </div>
  );
}
