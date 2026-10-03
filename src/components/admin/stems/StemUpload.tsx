'use client';

/**
 * Add stem WAVs to one master's stem folder.
 *
 * Same per-file queue and single-batch AbortController as BulkWavUpload (see
 * that file's header for why uploads run sequentially and why there is one
 * controller for the whole batch, not one per file) — but each file here
 * belongs to a specific master, and uploading is only half the job: once a
 * file lands in S3 it still has to be REGISTERED against the stem set (a
 * POST that also kicks off the worker's preview render), so each item has an
 * extra `registering` state between `uploading` and `done`.
 */

import { useCallback, useId, useRef, useState } from 'react';
import { UploadCloud, Check, RotateCw, X, Ban, FileAudio } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { uploadToWorkspace } from '@/lib/mastering-upload-client';
import { ACCEPTED_UPLOAD_TYPES } from '@/lib/mastering-storage';
import type { StemSet } from '@/types/stemSet';

type ItemState = 'queued' | 'uploading' | 'registering' | 'done' | 'error' | 'cancelled';

interface Item {
  uid: string;
  file: File;
  state: ItemState;
  pct: number;
  error?: string;
  /** Set once the upload itself lands, so a preview-register retry can skip re-uploading. */
  key?: string;
}

function looksLikeWav(file: File): boolean {
  if ((ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(file.type)) return true;
  return file.type === '' && /\.wave?$/i.test(file.name);
}

interface Props {
  masterJobId: string;
  /** Fired with the fresh stem set after each stem is registered. */
  onAdded: (set: StemSet) => void;
}

export function StemUpload({ masterJobId, onAdded }: Props) {
  const inputId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const patch = useCallback((uid: string, next: Partial<Item>) => {
    setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, ...next } : i)));
  }, []);

  /**
   * Register an already-uploaded key against the stem set (the POST that
   * also kicks off the worker's preview render). Split out from `runOne` so
   * a Retry after `previewQueued: false` can re-POST the same key without
   * re-uploading the file — `addStem` on the server is idempotent on key, so
   * this is a safe no-op append if nothing actually failed.
   *
   * `previewQueued: false` means the stem itself was saved (worth keeping,
   * worth calling `onAdded` for) but the worker invoke that renders its
   * listening copy never fired — left alone, that stem would sit at
   * `previewKey: null` forever with no visible error and no way to recover,
   * so it is surfaced here as a row error with a Retry rather than a silent
   * "Added".
   */
  const register = useCallback(
    async (item: Item, key: string, signal: AbortSignal) => {
      patch(item.uid, { state: 'registering', pct: 100, key, error: undefined });
      try {
        const res = await adminFetch(`/api/admin/stems/${masterJobId}/stems`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, filename: item.file.name }),
          signal,
        });
        const body = await res.json();
        if (!res.ok || !body.success) {
          throw new Error(body.error || 'Could not add that stem.');
        }
        onAdded(body.set as StemSet);
        if (body.previewQueued === false) {
          patch(item.uid, {
            state: 'error',
            error: "Saved, but its listening copy didn't start — Retry to try again.",
          });
          return;
        }
        patch(item.uid, { state: 'done' });
      } catch (err) {
        if (signal.aborted) {
          patch(item.uid, { state: 'cancelled', error: 'Cancelled.' });
          return;
        }
        patch(item.uid, { state: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },
    [masterJobId, onAdded, patch]
  );

  const runOne = useCallback(
    async (item: Item, signal: AbortSignal) => {
      patch(item.uid, { state: 'uploading', pct: 0, error: undefined });
      try {
        const key = await uploadToWorkspace(
          item.file,
          (loaded, total) => patch(item.uid, { pct: total ? Math.round((loaded / total) * 100) : 0 }),
          signal,
          'stem',
          { masterJobId }
        );
        await register(item, key, signal);
      } catch (err) {
        if (signal.aborted) {
          patch(item.uid, { state: 'cancelled', error: 'Cancelled.' });
          return;
        }
        patch(item.uid, { state: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },
    [masterJobId, patch, register]
  );

  const start = useCallback(
    async (picked: FileList | File[] | null) => {
      const list = picked ? Array.from(picked) : [];
      if (list.length === 0) return;

      const fresh: Item[] = list.map((file, n) => ({
        uid: `${Date.now()}-${n}-${file.name}`,
        file,
        state: looksLikeWav(file) ? 'queued' : 'error',
        pct: 0,
        error: looksLikeWav(file) ? undefined : `${file.name} is not a WAV — stems must be WAV.`,
      }));
      setItems((prev) => [...prev, ...fresh]);

      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      for (const item of fresh) {
        if (item.state === 'error') continue;
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
      // Already uploaded (a previewQueued: false row) — re-register only,
      // don't send the same WAV to S3 a second time.
      if (item.key) {
        await register(item, item.key, controller.signal);
      } else {
        await runOne(item, controller.signal);
      }
      setBusy(false);
      abort.current = null;
    },
    [items, register, runOne]
  );

  const clear = useCallback(() => setItems([]), []);

  const done = items.filter((i) => i.state === 'done').length;
  const failed = items.filter((i) => i.state === 'error').length;

  return (
    <div className="space-y-4">
      <div
        data-testid="stem-dropzone"
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
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? 'border-orange-400 bg-orange-50 dark:border-orange-500 dark:bg-orange-950/30'
            : 'border-gray-300 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/30'
        }`}
      >
        <UploadCloud
          className={`mx-auto h-8 w-8 ${dragging ? 'text-orange-500' : 'text-gray-400'}`}
          aria-hidden="true"
        />
        <p className="mt-2 text-sm font-medium text-gray-800 dark:text-gray-100">
          {dragging ? 'Drop them here' : "Drag this song's stem WAVs in"}
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
          accept=".wav,audio/wav"
          aria-label="Add stem WAVs"
          disabled={busy}
          onChange={(e) => void onPick(e)}
          className="sr-only"
        />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">WAV only, one upload at a time.</p>
      </div>

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-xs tabular-nums text-gray-500 dark:text-gray-400" role="status">
              {done} of {items.length} added
              {failed > 0 && <span className="text-red-600 dark:text-red-400"> · {failed} failed</span>}
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
                  className={`h-4 w-4 shrink-0 ${i.state === 'done' ? 'text-emerald-500' : 'text-gray-400'}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 grow truncate font-medium text-gray-800 dark:text-gray-100">
                  {i.file.name}
                </span>

                {i.state === 'uploading' && (
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                      <span
                        className="block h-full rounded-full bg-orange-500 transition-[width] duration-200"
                        style={{ width: `${i.pct}%` }}
                      />
                    </span>
                    <span className="w-9 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400">{i.pct}%</span>
                  </span>
                )}
                {i.state === 'registering' && (
                  <span className="shrink-0 text-xs text-gray-400">Adding…</span>
                )}
                {i.state === 'queued' && <span className="shrink-0 text-xs text-gray-400">Queued</span>}
                {i.state === 'done' && (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" /> Added
                  </span>
                )}
                {i.state === 'cancelled' && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <Ban className="h-3.5 w-3.5" aria-hidden="true" /> Cancelled
                  </span>
                )}
                {i.state === 'error' && (
                  <>
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
