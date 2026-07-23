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
  AlertTriangle, FileAudio, RotateCcw, X, Info,
} from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { pollJob } from '@/lib/poll-job';
import { statusFor } from '@/lib/loudness-targets';
import { MAX_UPLOAD_BYTES, ACCEPTED_UPLOAD_TYPES } from '@/lib/mastering-storage';
import { buildMasterReport, reportFilename } from '@/lib/master-report';
import { MasteringComparePlayer } from '@/components/admin/MasteringComparePlayer';
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

const MB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const lufs = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(1)} LUFS` : '—');
const dbtp = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(2)} dBTP` : '—');

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

export function MasteringStudio() {
  const inputId = useId();
  const [stage, setStage] = useState<Stage>('idle');
  /** Name/size only — survives a remount, unlike a File handle. */
  const [source, setSource] = useState<{ name: string; size: number } | null>(null);
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [sent, setSent] = useState({ loaded: 0, total: 0 });
  const [target, setTarget] = useState<number>(-14);
  const [job, setJob] = useState<MasterJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // Optional human title for the export. Storage stays UUID-based; this only
  // shapes the download filename and the saved report. Empty ⇒ de-noised default.
  const [masterName, setMasterName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [dragging, setDragging] = useState(false);

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
    setStage('idle');
    setSource(null);
    setSourceKey(null);
    setSent({ loaded: 0, total: 0 });
    setJob(null);
    setJobId(null);
    setError(null);
    setAnnounce('');
    if (fileInput.current) fileInput.current.value = '';
  }, []);

  /** Stop following, but leave the job running and recoverable. */
  const stopWatching = useCallback(() => {
    abort.current?.abort();
    setStage('ready');
    setAnnounce('Stopped watching. The master is still being produced.');
  }, []);

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
      setError(err instanceof Error ? err.message : String(err));
      setStage('idle');
      setSource(null);
    }
  }, []);

  const startMastering = useCallback(async () => {
    if (!sourceKey || !source) return;
    setError(null);
    setJob(null);
    try {
      const res = await adminFetch('/api/admin/music-lab/master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key: sourceKey, target }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `Could not start mastering (HTTP ${res.status}).`);
      const stored: StoredJob = { jobId: body.jobId, sourceKey, name: source.name, size: source.size, target };
      writeStored(stored);
      await watch(body.jobId, stored);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setStage('ready');
    }
  }, [sourceKey, source, target, watch]);

  const download = useCallback(async () => {
    if (!job?.masterKey) return;
    setError(null);
    try {
      // Present a friendly filename ("<title> (Master -14 LUFS).wav") when the
      // admin has named the master; the server sanitises it. Storage key is
      // untouched. No name ⇒ the route falls back to a de-noised default.
      const title = masterName.trim();
      const nameParam = title ? `&name=${encodeURIComponent(`${title} (Master ${job.target} LUFS)`)}` : '';
      const res = await adminFetch(
        `/api/admin/mastering/download?key=${encodeURIComponent(job.masterKey)}${nameParam}`
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
  }, [job, masterName]);

  /** Save the loudness summary as a text file that travels with the WAV. */
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
              <p className="text-xs text-gray-500 dark:text-gray-400">{MB(source.size)} · uploaded</p>
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
        </div>
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
            {verdict === 'on-target' && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
          </h2>

          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">Stage</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Integrated</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">True peak</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-800 dark:divide-gray-800 dark:text-gray-200">
                <tr>
                  <th scope="row" className="px-4 py-2 text-left font-normal">Source</th>
                  <td className="px-4 py-2 text-right tabular-nums">{lufs(job.beforeLufs)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{dbtp(job.beforeTp)}</td>
                </tr>
                <tr className="bg-emerald-50/40 dark:bg-emerald-500/5">
                  <th scope="row" className="px-4 py-2 text-left font-medium">Mastered</th>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{lufs(job.afterLufs)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{dbtp(job.afterTp)}</td>
                </tr>
              </tbody>
            </table>
          </div>

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
            <button
              type="button"
              onClick={downloadReport}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <FileAudio className="h-4 w-4" aria-hidden="true" /> Download report
            </button>
          </div>

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

      {busy && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Leaving this page will not stop the work — it re-attaches when you return.
        </p>
      )}
    </div>
  );
}
