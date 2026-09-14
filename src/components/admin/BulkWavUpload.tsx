'use client';

/**
 * Put a whole batch of WAVs into the mastering workspace in one go.
 *
 * Every other uploader in the admin is single-file, so ten Suno stems meant ten
 * trips through the Sound Engineering drop zone. This takes the batch — but
 * uploads each file individually through the SAME presigned route, so no
 * archive is ever sent and nothing extracts untrusted input server-side. That
 * was the deciding trade against accepting a ZIP.
 *
 * Uploads run in sequence, not in parallel: a presigned POST of a 500 MB WAV
 * saturates the link on its own, and ten at once would just make each one
 * slower while making the progress display a lie.
 */

import { useCallback, useId, useRef, useState } from 'react';
import { UploadCloud, Check, RotateCw } from 'lucide-react';
import { uploadToWorkspace } from '@/lib/mastering-upload-client';
import { ACCEPTED_UPLOAD_TYPES } from '@/lib/mastering-storage';

type ItemState = 'queued' | 'uploading' | 'done' | 'error';

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

export function BulkWavUpload() {
  const inputId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const patch = useCallback((uid: string, next: Partial<Item>) => {
    setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, ...next } : i)));
  }, []);

  /** Upload one item. Never throws — a failure is state on that row. */
  const runOne = useCallback(
    async (item: Item) => {
      const controller = new AbortController();
      abort.current = controller;
      patch(item.uid, { state: 'uploading', pct: 0, error: undefined });
      try {
        const key = await uploadToWorkspace(
          item.file,
          (loaded, total) => patch(item.uid, { pct: total ? Math.round((loaded / total) * 100) : 0 }),
          controller.signal
        );
        patch(item.uid, { state: 'done', pct: 100, key });
      } catch (err) {
        patch(item.uid, { state: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },
    [patch]
  );

  const onPick = useCallback(
    async (picked: FileList | null) => {
      if (!picked || picked.length === 0) return;
      const fresh: Item[] = Array.from(picked).map((file, n) => ({
        uid: `${Date.now()}-${n}-${file.name}`,
        file,
        // Rejected here so a non-WAV never costs a presign round trip.
        state: looksLikeWav(file) ? 'queued' : 'error',
        pct: 0,
        error: looksLikeWav(file) ? undefined : `${file.name} is not a WAV — the workspace takes WAV only.`,
      }));
      setItems((prev) => [...prev, ...fresh]);

      setBusy(true);
      // Sequential on purpose. See the header comment.
      for (const item of fresh) {
        if (item.state === 'error') continue;
        await runOne(item);
      }
      setBusy(false);
    },
    [runOne]
  );

  const retry = useCallback(
    async (uid: string) => {
      const item = items.find((i) => i.uid === uid);
      if (!item) return;
      setBusy(true);
      await runOne(item);
      setBusy(false);
    },
    [items, runOne]
  );

  const done = items.filter((i) => i.state === 'done').length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center dark:border-gray-700">
        <UploadCloud className="mx-auto h-8 w-8 text-gray-400" aria-hidden="true" />
        <label htmlFor={inputId} className="mt-2 block text-sm font-medium text-gray-700 dark:text-gray-200">
          Choose WAV files
        </label>
        <input
          id={inputId}
          type="file"
          multiple
          accept=".wav,audio/wav,audio/x-wav,audio/wave"
          disabled={busy}
          onChange={(e) => void onPick(e.target.files)}
          className="mt-2 text-sm"
        />
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Uploads one at a time into the mastering workspace. WAV only, 500 MB each.
        </p>
      </div>

      {items.length > 0 && (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400" role="status">
            {done} of {items.length} uploaded
          </p>
          <ul className="space-y-1">
            {items.map((i) => (
              <li
                key={i.uid}
                className="flex flex-wrap items-center gap-2 rounded border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
              >
                <span className="min-w-0 grow truncate">{i.file.name}</span>
                {i.state === 'uploading' && (
                  <span className="tabular-nums text-xs text-gray-500">{i.pct}%</span>
                )}
                {i.state === 'queued' && <span className="text-xs text-gray-400">Queued</span>}
                {i.state === 'done' && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" /> Uploaded
                  </span>
                )}
                {i.state === 'error' && (
                  <>
                    <span className="text-xs text-red-600 dark:text-red-400">{i.error}</span>
                    {looksLikeWav(i.file) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void retry(i.uid)}
                        className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:underline disabled:opacity-50 dark:text-orange-400"
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
