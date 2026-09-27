'use client';

/**
 * Put a whole batch of WAVs into the mastering workspace in one go.
 *
 * This is the transfer step of the karaoke workflow: Suno exports a song as
 * nine-ish 32-bit stems, and they have to reach S3 before ffmpeg and demucs can
 * work on them from the box. Every other uploader in the admin is single-file,
 * so that meant nine trips through the Sound Engineering drop zone.
 *
 * Each file still goes through the SAME presigned route one at a time, so no
 * archive is ever sent and nothing extracts untrusted input server-side. That
 * was the deciding trade against accepting a ZIP.
 *
 * Uploads run in sequence, not in parallel: a presigned POST of a 500 MB WAV
 * saturates the link on its own, and ten at once would just make each one
 * slower while making the progress display a lie.
 *
 * ⚠️ ONE AbortController FOR THE WHOLE BATCH, not one per file. An earlier
 * version created a controller per item, stored it, and never read it — so a
 * running batch could not be stopped at all and the only exit was closing the
 * tab mid-transfer. The signal is checked between items too, so Cancel stops
 * the QUEUE rather than only the file currently in flight.
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { UploadCloud, Check, RotateCw, X, Ban, FileAudio } from 'lucide-react';
import { uploadToWorkspace } from '@/lib/mastering-upload-client';
import { ACCEPTED_UPLOAD_TYPES } from '@/lib/mastering-storage';

type ItemState = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';

interface Item {
  /** Stable across retries, so React keeps the row rather than remounting it. */
  uid: string;
  file: File;
  state: ItemState;
  pct: number;
  key?: string;
  error?: string;
}

/** A WAV by declared type, or by extension when the browser sends nothing. */
function looksLikeWav(file: File): boolean {
  if ((ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(file.type)) return true;
  return file.type === '' && /\.wave?$/i.test(file.name);
}

function mb(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function BulkWavUpload() {
  const inputId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** The batch's controller. Null when nothing is running. */
  const abort = useRef<AbortController | null>(null);

  const patch = useCallback((uid: string, next: Partial<Item>) => {
    setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, ...next } : i)));
  }, []);

  /** Upload one item. Never throws — a failure is state on that row. */
  const runOne = useCallback(
    async (item: Item, signal: AbortSignal) => {
      patch(item.uid, { state: 'uploading', pct: 0, error: undefined });
      try {
        const key = await uploadToWorkspace(
          item.file,
          (loaded, total) => patch(item.uid, { pct: total ? Math.round((loaded / total) * 100) : 0 }),
          signal
        );
        patch(item.uid, { state: 'done', pct: 100, key });
      } catch (err) {
        // An abort is a deliberate stop, not a failure — it must not offer a
        // Retry that looks like something went wrong.
        if (signal.aborted) {
          patch(item.uid, { state: 'cancelled', error: 'Cancelled.' });
          return;
        }
        patch(item.uid, { state: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },
    [patch]
  );

  const start = useCallback(
    async (picked: FileList | File[] | null) => {
      const list = picked ? Array.from(picked) : [];
      if (list.length === 0) return;

      const fresh: Item[] = list.map((file, n) => ({
        uid: `${Date.now()}-${n}-${file.name}`,
        file,
        // Rejected here so a non-WAV never costs a presign round trip.
        state: looksLikeWav(file) ? 'queued' : 'error',
        pct: 0,
        error: looksLikeWav(file) ? undefined : `${file.name} is not a WAV — the workspace takes WAV only.`,
      }));
      setItems((prev) => [...prev, ...fresh]);

      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      // Sequential on purpose. See the header comment.
      for (const item of fresh) {
        if (item.state === 'error') continue;
        // Checked BETWEEN files, so Cancel stops the queue and not just the
        // transfer already in flight.
        if (controller.signal.aborted) {
          patch(item.uid, { state: 'cancelled', error: 'Cancelled.' });
          continue;
        }
        await runOne(item, controller.signal);
      }
      setBusy(false);
      abort.current = null;
    },
    [patch, runOne]
  );

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files;
      // Clear the value so choosing the SAME file again still fires `change` —
      // otherwise re-uploading a corrected export under its original name is a
      // silent no-op. Same reason as BriefReusePanel.
      e.target.value = '';
      await start(picked);
    },
    [start]
  );

  const cancel = useCallback(() => {
    abort.current?.abort();
  }, []);

  const retry = useCallback(
    async (uid: string) => {
      const item = items.find((i) => i.uid === uid);
      if (!item) return;
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      await runOne(item, controller.signal);
      setBusy(false);
      abort.current = null;
    },
    [items, runOne]
  );

  const clear = useCallback(() => setItems([]), []);

  const done = items.filter((i) => i.state === 'done').length;
  const failed = items.filter((i) => i.state === 'error').length;
  const totalBytes = useMemo(() => items.reduce((n, i) => n + i.file.size, 0), [items]);

  return (
    <div className="space-y-4">
      <div
        data-testid="bulk-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          void start(e.dataTransfer?.files ?? null);
        }}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging
            ? 'border-orange-400 bg-orange-50 dark:border-orange-500 dark:bg-orange-950/30'
            : 'border-gray-300 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/30'
        }`}
      >
        <UploadCloud
          className={`mx-auto h-9 w-9 ${dragging ? 'text-orange-500' : 'text-gray-400'}`}
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-medium text-gray-800 dark:text-gray-100">
          {dragging ? 'Drop them here' : 'Drag a whole stem export in'}
        </p>
        <label
          htmlFor={inputId}
          className="mt-1 block cursor-pointer text-sm text-orange-600 hover:underline dark:text-orange-400"
        >
          Choose WAV files
        </label>
        <input
          id={inputId}
          type="file"
          multiple
          accept=".wav,audio/wav,audio/x-wav,audio/wave"
          disabled={busy}
          onChange={(e) => void onPick(e)}
          className="sr-only"
        />
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Uploads one at a time into the mastering workspace. WAV only, 500 MB each.
        </p>
      </div>

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div
              role="progressbar"
              aria-label="Batch upload progress"
              aria-valuemin={0}
              aria-valuenow={done}
              aria-valuemax={items.length}
              className="h-1.5 min-w-[8rem] grow overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs tabular-nums text-gray-500 dark:text-gray-400" role="status">
              {done} of {items.length} uploaded
              {failed > 0 && <span className="text-red-600 dark:text-red-400"> · {failed} failed</span>}
              <span className="text-gray-400 dark:text-gray-500"> · {mb(totalBytes)}</span>
            </p>
            {busy ? (
              <button
                type="button"
                onClick={cancel}
                className="flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={clear}
                className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Clear
              </button>
            )}
          </div>

          <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {items.map((i) => (
              <li key={i.uid} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <FileAudio
                  className={`h-4 w-4 shrink-0 ${
                    i.state === 'done' ? 'text-emerald-500' : 'text-gray-400'
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 grow truncate font-medium text-gray-800 dark:text-gray-100">
                  {i.file.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-gray-400">{mb(i.file.size)}</span>

                {i.state === 'uploading' && (
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                      <span
                        className="block h-full rounded-full bg-orange-500 transition-[width] duration-200"
                        style={{ width: `${i.pct}%` }}
                      />
                    </span>
                    <span className="w-9 text-right text-xs tabular-nums text-gray-500">{i.pct}%</span>
                  </span>
                )}
                {i.state === 'queued' && <span className="shrink-0 text-xs text-gray-400">Queued</span>}
                {i.state === 'done' && (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" /> Uploaded
                  </span>
                )}
                {i.state === 'cancelled' && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <Ban className="h-3.5 w-3.5" aria-hidden="true" /> Cancelled
                  </span>
                )}
                {i.state === 'error' && (
                  <>
                    {/* A live region: the batch counter announces progress, so a
                        silent row failure leaves a screen-reader user hearing
                        the count stall with no reason given. */}
                    <span role="alert" className="text-xs text-red-600 dark:text-red-400">
                      {i.error}
                    </span>
                    {looksLikeWav(i.file) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void retry(i.uid)}
                        className="flex shrink-0 items-center gap-1 text-xs font-medium text-orange-600 hover:underline disabled:opacity-50 dark:text-orange-400"
                      >
                        <RotateCw className="h-3 w-3" aria-hidden="true" /> Retry
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
