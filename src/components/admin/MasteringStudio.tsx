'use client';

/**
 * Sound Engineering & Mastering — the whole module in one guided page.
 *
 * Pipeline this serves: export the WAV from SUNO -> upload here -> master to a
 * streaming target -> download the mastered WAV -> cut picture in Adobe.
 *
 * Three things the UI is deliberately opinionated about, because each one is a
 * mistake the API alone can't prevent:
 *  - WAV only. Mastering an MP3 re-levels a file that has already lost detail.
 *  - The master is measured on the way out (`afterLufs`), so "did it work?" is
 *    answered on screen instead of by downloading the file and trusting it.
 *  - Master ONCE. Premiere's "Auto-Match to -14" silently undoes the whole job,
 *    so the hand-off note sits next to the download button, not in a doc.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  SlidersHorizontal, Upload, Download, Loader2, CheckCircle2,
  AlertTriangle, FileAudio, RotateCcw,
} from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { pollJob } from '@/lib/poll-job';
import { MAX_UPLOAD_BYTES, ACCEPTED_UPLOAD_TYPES } from '@/lib/mastering-storage';
import type { MasterJob } from '@/types/masterJob';

/** Where the platforms normalise playback. Anything else is a custom target. */
const TARGETS = [
  { lufs: -14, label: '-14 LUFS', for: 'Spotify · YouTube · Amazon · TIDAL' },
  { lufs: -16, label: '-16 LUFS', for: 'Apple Music' },
] as const;

type Stage = 'idle' | 'uploading' | 'ready' | 'mastering' | 'done';

const MB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const lufs = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(1)} LUFS` : '—');
const dbtp = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(2)} dBTP` : '—');

/** Upload straight to S3 with progress. fetch() can't report upload progress. */
function putToS3(
  uploadUrl: string,
  fields: Record<string, string>,
  file: File,
  onProgress: (pct: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    // Every policy field first, the file part LAST — S3 requires this order.
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`S3 rejected the upload (HTTP ${xhr.status}).`));
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export function MasteringStudio() {
  const inputId = useId();
  const [stage, setStage] = useState<Stage>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [target, setTarget] = useState<number>(-14);
  const [job, setJob] = useState<MasterJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const mounted = useRef(true);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  // Elapsed counter while the worker runs — a two-pass loudnorm on a long WAV
  // can take a minute, and silence with no clock reads as "stuck".
  useEffect(() => {
    if (stage !== 'mastering') return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  const reset = useCallback(() => {
    abort.current?.abort();
    setStage('idle');
    setFile(null);
    setSourceKey(null);
    setProgress(0);
    setJob(null);
    setError(null);
  }, []);

  const onPick = useCallback(async (picked: File | null) => {
    if (!picked) return;
    setError(null);
    setJob(null);

    const typeOk =
      (ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(picked.type) ||
      /\.wave?$/i.test(picked.name); // some browsers report an empty type for .wav
    if (!typeOk) {
      setError('That is not a WAV. Export the lossless WAV from SUNO — mastering an MP3 only re-levels a file that has already lost detail.');
      return;
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setError(`That file is ${MB(picked.size)}. The limit is ${MB(MAX_UPLOAD_BYTES)}.`);
      return;
    }

    setFile(picked);
    setStage('uploading');
    setProgress(0);
    abort.current = new AbortController();

    try {
      const res = await adminFetch('/api/admin/mastering/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: picked.name, contentType: picked.type || 'audio/wav', size: picked.size }),
        signal: abort.current.signal,
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `Could not start the upload (HTTP ${res.status}).`);

      await putToS3(body.uploadUrl, body.fields, picked, (p) => mounted.current && setProgress(p), abort.current.signal);
      if (!mounted.current) return;
      setSourceKey(body.key);
      setStage('ready');
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setStage('idle');
      setFile(null);
    }
  }, []);

  const startMastering = useCallback(async () => {
    if (!sourceKey) return;
    setError(null);
    setStage('mastering');
    abort.current = new AbortController();
    const signal = abort.current.signal;

    try {
      const res = await adminFetch('/api/admin/music-lab/master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key: sourceKey, target }),
        signal,
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `Could not start mastering (HTTP ${res.status}).`);

      const done = await pollJob<MasterJob>({
        // The status route returns the job flattened; pollJob's contract is
        // {status, result, error}. Reshape here rather than duplicating its
        // abort-aware poll loop.
        fetchStatus: async (s) => {
          const r = await adminFetch(`/api/admin/music-lab/master/${body.jobId}`, { signal: s });
          if (!r.ok) return r;
          const j = (await r.json()) as MasterJob;
          return new Response(JSON.stringify({ status: j.status, result: j, error: j.error }), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
        signal,
        isMounted: () => mounted.current,
        intervalMs: 3000,
        timeoutMs: 16 * 60 * 1000, // the worker's own ceiling is 15 min
        timeoutMessage: 'Mastering is taking longer than expected — check the job in Music Lab.',
      });
      if (!mounted.current || !done) return;
      setJob(done);
      setStage('done');
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setStage('ready');
    }
  }, [sourceKey, target]);

  const download = useCallback(async () => {
    if (!job?.masterKey) return;
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/mastering/download?key=${encodeURIComponent(job.masterKey)}`);
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not create the download link.');
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [job]);

  // Did it land where we asked? This is the whole point of the after-measurement.
  const onTarget =
    typeof job?.afterLufs === 'number' && Math.abs(job.afterLufs - (job.target ?? target)) <= 0.1;
  const movedLu =
    typeof job?.beforeLufs === 'number' && typeof job?.afterLufs === 'number'
      ? Math.abs(job.afterLufs - job.beforeLufs)
      : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <SlidersHorizontal className="h-6 w-6 text-orange-600" />
          Sound Engineering &amp; Mastering
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
          Export the WAV from SUNO, master it to a streaming target here, then take the mastered WAV into Adobe.
          This is <strong>loudness</strong> mastering — level and true-peak only, never EQ, compression or tone.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 1 — source */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          1 · Source WAV from SUNO
        </h2>

        {stage === 'idle' && (
          <>
            <label
              htmlFor={inputId}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center transition hover:border-orange-400 hover:bg-orange-50/40 dark:border-gray-700 dark:hover:border-orange-500 dark:hover:bg-orange-500/5"
            >
              <Upload className="h-6 w-6 text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Choose a WAV file</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                WAV only · up to {MB(MAX_UPLOAD_BYTES)} · uploads straight to S3
              </span>
            </label>
            <input
              id={inputId}
              type="file"
              accept=".wav,audio/wav,audio/x-wav"
              className="sr-only"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </>
        )}

        {stage === 'uploading' && file && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="truncate">Uploading {file.name}</span>
              <span className="ml-auto tabular-nums text-gray-500">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {(stage === 'ready' || stage === 'mastering' || stage === 'done') && file && (
          <div className="flex items-center gap-3 text-sm">
            <FileAudio className="h-5 w-5 shrink-0 text-gray-400" />
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-900 dark:text-gray-100">{file.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{MB(file.size)} · uploaded</p>
            </div>
            {stage !== 'mastering' && (
              <button
                type="button"
                onClick={reset}
                className="ml-auto flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <RotateCcw className="h-3 w-3" /> Start over
              </button>
            )}
          </div>
        )}
      </section>

      {/* 2 — target + run */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          2 · Target &amp; master
        </h2>

        <div className="flex flex-wrap gap-2">
          {TARGETS.map((t) => (
            <button
              key={t.lufs}
              type="button"
              disabled={stage === 'mastering'}
              onClick={() => setTarget(t.lufs)}
              className={`rounded-lg border px-4 py-2 text-left transition disabled:opacity-50 ${
                target === t.lufs
                  ? 'border-orange-500 bg-orange-50 dark:border-orange-500 dark:bg-orange-500/10'
                  : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
              }`}
            >
              <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{t.label}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{t.for}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Each target writes its own file, so you can master the same song for both without one overwriting the other.
        </p>

        <button
          type="button"
          onClick={startMastering}
          disabled={stage !== 'ready'}
          className="mt-4 flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {stage === 'mastering' ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
          {stage === 'mastering' ? `Mastering… ${elapsed}s` : `Master to ${target} LUFS`}
        </button>
        {stage === 'mastering' && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Two-pass loudnorm — measure, then correct. Usually well under a minute; long sources can take a few.
          </p>
        )}
      </section>

      {/* 3 — result + hand-off */}
      {stage === 'done' && job && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            3 · Result
            {onTarget && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          </h2>

          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Stage</th>
                  <th className="px-4 py-2 text-right font-semibold">Integrated</th>
                  <th className="px-4 py-2 text-right font-semibold">True peak</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-800 dark:divide-gray-800 dark:text-gray-200">
                <tr>
                  <td className="px-4 py-2">Source</td>
                  <td className="px-4 py-2 text-right tabular-nums">{lufs(job.beforeLufs)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{dbtp(job.beforeTp)}</td>
                </tr>
                <tr className="bg-emerald-50/40 dark:bg-emerald-500/5">
                  <td className="px-4 py-2 font-medium">Mastered</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{lufs(job.afterLufs)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{dbtp(job.afterTp)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
            {onTarget
              ? `Landed on ${job.target} LUFS, peak-safe.`
              : `Measured ${lufs(job.afterLufs)} against a ${job.target} LUFS target — worth a listen before you use it.`}
            {movedLu !== null && movedLu < 1 && (
              <span className="text-gray-500 dark:text-gray-400">
                {' '}The source moved {movedLu.toFixed(2)} LU — below what anyone can hear, which is the correct
                outcome for a song that was already on target.
              </span>
            )}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={download}
              className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              <Download className="h-4 w-4" /> Download for Adobe
            </button>
            <code className="truncate rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {job.masterKey}
            </code>
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
    </div>
  );
}
