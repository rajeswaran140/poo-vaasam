'use client';

/**
 * A saved master's stem library — upload, list, rename, remove, play and
 * download its separate parts. Task 12 adds the remix mixer below the list;
 * this component only owns the set itself.
 *
 * The worker renders each stem's listening copy (a small streamable file)
 * one at a time after it's registered, so `previewKey` starts out null and
 * fills in later. While any stem is still waiting on its copy, this page
 * polls the set every 4 seconds so the "Preparing…" status clears itself
 * without a manual refresh; it stops polling the moment nothing is pending,
 * and always on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Pencil, Trash2, Download, Play, RotateCw } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { formatClock } from '@/components/admin/ShortWindowFields';
import { StemUpload } from '@/components/admin/stems/StemUpload';
import { StemMixer } from '@/components/admin/stems/StemMixer';
import type { StemEntry, StemMixEntry, StemRemix, StemSet } from '@/types/stemSet';

interface MasterInfo {
  id: string;
  title: string | null;
  target: number;
}

interface RowError {
  stemId: string;
  message: string;
}

/** 5 minutes: how long a stem can sit with no previewKey and no previewError
 * before StemsStudio stops treating it as "still rendering" and offers a
 * Retry instead. Guards against an Event invoke that "succeeded" (Lambda
 * accepted it) but whose worker never wrote previewKey/previewError back —
 * an old worker without a stemPreview branch, a timeout, an OOM, a crash. */
const STALE_PREVIEW_MS = 5 * 60 * 1000;

function isPendingPreview(stem: StemEntry): boolean {
  return stem.previewKey === null && stem.previewError === null;
}

/**
 * A pending stem counts as stale once more than 5 minutes have passed since
 * `previewRequestedAt` — or immediately, if it has none (a stem added before
 * this field existed; every new add stamps it, so null here can only mean
 * "from before").
 */
function isStalePending(stem: StemEntry, now: number): boolean {
  if (!isPendingPreview(stem)) return false;
  if (stem.previewRequestedAt == null) return true;
  const requested = Date.parse(stem.previewRequestedAt);
  if (Number.isNaN(requested)) return true;
  return now - requested > STALE_PREVIEW_MS;
}

function hasPendingPreview(set: StemSet | null, now: number): boolean {
  if (!set) return false;
  return set.order.some((id) => {
    const stem = set.stems[id];
    return !!stem && isPendingPreview(stem) && !isStalePending(stem, now);
  });
}

/** How often the render section re-polls the set while a remix is in flight. */
const RENDER_POLL_MS = 4000;
/** 10 minutes: past this the worker is presumed stuck rather than still rendering. */
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;
const RENDER_TIMEOUT_MESSAGE =
  'The remix is taking longer than expected — reload to check on it.';

/** What a render ends up at, given the latest poll's `remix` (undefined on a
 * failed poll tick, where there is no fresh set to read) against the watch
 * started right after the POST. */
type RenderOutcome = 'continue' | 'done' | 'timeout' | { error: string };

function renderWatchOutcome(
  remix: StemRemix | null | undefined,
  watch: { priorRenderedAt: string | null; deadline: number },
  now: number
): RenderOutcome {
  if (remix?.renderedAt && remix.renderedAt !== watch.priorRenderedAt) return 'done';
  if (remix?.error) return { error: remix.error };
  if (now > watch.deadline) return 'timeout';
  return 'continue';
}

/** 48000 -> "48 kHz", 44100 -> "44.1 kHz". */
function formatRate(sampleRate: number): string {
  const khz = sampleRate / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

/** The sample rate most stems in the set share. Null when there are none. */
function majoritySampleRate(set: StemSet): number | null {
  const counts = new Map<number, number>();
  for (const id of set.order) {
    const rate = set.stems[id]?.sampleRate;
    if (rate == null) continue;
    counts.set(rate, (counts.get(rate) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [rate, count] of counts) {
    if (count > bestCount) {
      best = rate;
      bestCount = count;
    }
  }
  return best;
}

/** The longest stem's duration in the set. Null when none have one yet. */
function longestDuration(set: StemSet): number | null {
  let longest: number | null = null;
  for (const id of set.order) {
    const d = set.stems[id]?.durationSec;
    if (d == null) continue;
    if (longest === null || d > longest) longest = d;
  }
  return longest;
}

function formatSeconds(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

interface Props {
  masterJobId: string;
}

export function StemsStudio({ masterJobId }: Props) {
  const [set, setSet] = useState<StemSet | null>(null);
  const [master, setMaster] = useState<MasterInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [playUrls, setPlayUrls] = useState<Record<string, string>>({});
  const [playLoading, setPlayLoading] = useState<string | null>(null);
  const [renderBusy, setRenderBusy] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [remixPlayUrl, setRemixPlayUrl] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The render poll's OWN timer — kept separate from `timerRef` (the preview
  // poll's), so a preview tick clearing its timer can never cancel an
  // in-flight remix poll, or the other way round.
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set right after a successful POST to /remix; null whenever no render is
  // being watched. `priorRenderedAt` is what `set.remix.renderedAt` was
  // BEFORE this render, so a poll can tell "finished" from "still the old one".
  const renderWatchRef = useRef<{ priorRenderedAt: string | null; deadline: number } | null>(null);
  // Set once the first load completes, so a remix.error already on the set
  // (persisted by the server from an earlier session) is shown on arrival —
  // the remix route's own invoke-failure path writes it for exactly this —
  // without a later, unrelated background poll able to overwrite it.
  const initialLoadRef = useRef(false);
  const mountedRef = useRef(true);
  // The last set this page actually saw, kept outside React state so a
  // failed poll tick can decide whether to keep polling without `load`
  // itself depending on `set` (which would recreate `load` on every
  // render and retrigger the mount effect below).
  const setRef = useRef<StemSet | null>(null);
  useEffect(() => {
    setRef.current = set;
  }, [set]);

  const scheduleIfPending = useCallback(
    (next: StemSet | null, poll: () => void) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (hasPendingPreview(next, Date.now())) {
        timerRef.current = setTimeout(poll, 4000);
      }
    },
    []
  );

  /**
   * Advance (or end) the render watch against whatever `remix` this poll
   * tick actually saw — `undefined` on a failed tick, which only the
   * deadline can end. Mirrors the preview poll's own resilience: a transient
   * GET failure must not strand the button disabled forever.
   */
  const continueRenderWatch = useCallback(
    (remix: StemRemix | null | undefined) => {
      const watch = renderWatchRef.current;
      if (!watch) return;
      const outcome = renderWatchOutcome(remix, watch, Date.now());
      if (outcome === 'continue') {
        if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
        renderTimerRef.current = setTimeout(() => void load(), RENDER_POLL_MS);
        return;
      }
      renderWatchRef.current = null;
      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
      setRenderBusy(false);
      if (outcome === 'timeout') setRenderError(RENDER_TIMEOUT_MESSAGE);
      else if (outcome === 'done') setRenderError(null);
      else setRenderError(outcome.error);
    },
    // `load` is stable in identity only across THIS render — referenced here
    // the same way the preview poll already references itself recursively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const load = useCallback(async () => {
    try {
      const res = await adminFetch(`/api/admin/stems/${masterJobId}`);
      const body = await res.json();
      if (!mountedRef.current) return;
      if (!res.ok || !body.success) {
        setLoadError(body.error || 'Could not load the stems.');
        // A failed poll tick must not end the poll for good — the set we
        // last loaded successfully may still have pending stems waiting on
        // their listening copy, and this failure is as likely to be a
        // transient blip as a real outage.
        if (hasPendingPreview(setRef.current, Date.now())) {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => void load(), 4000);
        }
        continueRenderWatch(undefined);
        return;
      }
      setLoadError(null);
      const nextSet = body.set as StemSet | null;
      setSet(nextSet);
      setMaster(body.master as MasterInfo);
      scheduleIfPending(nextSet, () => void load());
      if (!initialLoadRef.current) {
        initialLoadRef.current = true;
        if (nextSet?.remix?.error) setRenderError(nextSet.remix.error);
      }
      continueRenderWatch(nextSet?.remix ?? null);
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(err instanceof Error ? err.message : String(err));
      if (hasPendingPreview(setRef.current, Date.now())) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void load(), 4000);
      }
      continueRenderWatch(undefined);
    }
  }, [masterJobId, scheduleIfPending, continueRenderWatch]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    };
  }, [load]);

  const handleAdded = useCallback(
    (next: StemSet) => {
      setSet(next);
      scheduleIfPending(next, () => void load());
    },
    [load, scheduleIfPending]
  );

  const handleMixChange = useCallback((mix: Record<string, StemMixEntry>) => {
    setSet((prev) => (prev ? { ...prev, mix } : prev));
  }, []);

  const startRename = useCallback((id: string, current: string) => {
    setRenaming(id);
    setRenameValue(current);
  }, []);

  const cancelRename = useCallback(() => setRenaming(null), []);

  const submitRename = useCallback(
    async (id: string) => {
      const name = renameValue.trim();
      if (!name) {
        setRenaming(null);
        return;
      }
      try {
        const res = await adminFetch(`/api/admin/stems/${masterJobId}/stems/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const body = await res.json();
        if (!res.ok || !body.success) {
          setRowError({ stemId: id, message: body.error || 'Could not rename that stem.' });
          setRenaming(null);
          return;
        }
        setSet((prev) =>
          prev ? { ...prev, stems: { ...prev.stems, [id]: { ...prev.stems[id], name } } } : prev
        );
        setRowError((prev) => (prev?.stemId === id ? null : prev));
        setRenaming(null);
      } catch (err) {
        setRowError({ stemId: id, message: err instanceof Error ? err.message : String(err) });
        setRenaming(null);
      }
    },
    [masterJobId, renameValue]
  );

  const removeStem = useCallback(
    async (id: string, name: string) => {
      if (!window.confirm(`Remove ${name}? You would have to upload it again.`)) return;
      try {
        const res = await adminFetch(`/api/admin/stems/${masterJobId}/stems/${id}`, { method: 'DELETE' });
        const body = await res.json();
        if (!res.ok || !body.success) {
          setRowError({ stemId: id, message: body.error || 'Could not remove that stem.' });
          return;
        }
        setRowError((prev) => (prev?.stemId === id ? null : prev));
        setSet((prev) => {
          if (!prev) return prev;
          const rest = { ...prev.stems };
          delete rest[id];
          return { ...prev, order: prev.order.filter((x) => x !== id), stems: rest };
        });
      } catch (err) {
        setRowError({ stemId: id, message: err instanceof Error ? err.message : String(err) });
      }
    },
    [masterJobId]
  );

  const downloadStem = useCallback(async (id: string, stem: StemEntry) => {
    try {
      const res = await adminFetch(
        `/api/admin/mastering/download?key=${encodeURIComponent(stem.key)}&name=${encodeURIComponent(stem.name)}`
      );
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not create the download link.');
      window.open(body.url, '_blank', 'noopener');
    } catch (err) {
      setRowError({ stemId: id, message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const playStem = useCallback(async (id: string, previewKey: string) => {
    setPlayLoading(id);
    try {
      const res = await adminFetch(
        `/api/admin/mastering/download?key=${encodeURIComponent(previewKey)}&mode=play`
      );
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not load that preview.');
      setPlayUrls((prev) => ({ ...prev, [id]: body.url }));
    } catch (err) {
      setRowError({ stemId: id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setPlayLoading(null);
    }
  }, []);

  /**
   * Re-POST a stem that already failed to get its listening copy started
   * (`previewError` set, persisted by the server — see the POST route).
   * Same endpoint as the initial add; `addStem` is idempotent on key, so
   * this re-registers rather than duplicating the stem, and the route
   * clears the old error and asks the worker again before replying.
   */
  const retryPreview = useCallback(
    async (id: string, stem: StemEntry) => {
      try {
        const filename = stem.key.split('/').pop() || stem.name;
        const res = await adminFetch(`/api/admin/stems/${masterJobId}/stems`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: stem.key, filename }),
        });
        const body = await res.json();
        if (!res.ok || !body.success) {
          setRowError({ stemId: id, message: body.error || "Could not retry that stem's listening copy." });
          return;
        }
        setRowError((prev) => (prev?.stemId === id ? null : prev));
        handleAdded(body.set as StemSet);
      } catch (err) {
        setRowError({ stemId: id, message: err instanceof Error ? err.message : String(err) });
      }
    },
    [masterJobId, handleAdded]
  );

  /**
   * Queue a render of the saved mix. The body carries nothing — the server
   * always renders from the stored mix, never anything this page sends — so
   * there is nothing to build here but the request itself.
   */
  const handleRender = useCallback(async () => {
    setRenderError(null);
    setRenderBusy(true);
    // Captured BEFORE the POST: the poll below ends on the first renderedAt
    // that differs from this, never on the one already sitting there from a
    // previous render.
    const priorRenderedAt = set?.remix?.renderedAt ?? null;
    try {
      const res = await adminFetch(`/api/admin/stems/${masterJobId}/remix`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setRenderBusy(false);
        setRenderError(body.error || 'Could not start the remix.');
        return;
      }
      renderWatchRef.current = { priorRenderedAt, deadline: Date.now() + RENDER_TIMEOUT_MS };
      if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
      renderTimerRef.current = setTimeout(() => void load(), RENDER_POLL_MS);
    } catch (err) {
      setRenderBusy(false);
      setRenderError(err instanceof Error ? err.message : String(err));
    }
  }, [masterJobId, set, load]);

  // The remix's play URL, resolved whenever its key changes — including the
  // very first load, when a remix rendered earlier already has one. Never
  // gated on `renderBusy`: an older remix stays playable while a new one renders.
  const remixKey = set?.remix?.key ?? null;
  useEffect(() => {
    // Unconditional: a NEW key's own URL has not been fetched yet, so the
    // old remix's URL must not linger under it — playing the old mix while
    // "Remix ready" already shows the new one's notes would be silently wrong.
    setRemixPlayUrl(null);
    if (!remixKey) return;
    let active = true;
    void (async () => {
      try {
        const res = await adminFetch(`/api/admin/mastering/download?key=${encodeURIComponent(remixKey)}&mode=play`);
        const body = await res.json();
        if (active && res.ok && body.success) setRemixPlayUrl(body.url);
      } catch {
        // "Remix ready" still shows; just without playback until a retry.
      }
    })();
    return () => {
      active = false;
    };
  }, [remixKey]);

  // "Master this remix" — same target id MasteringStudio's own `targetIdOf`
  // would derive from this master's `target` (the GET route hands back no
  // `normalizationMode`, so that derivation always lands on the plain number).
  const remixMasterHref =
    remixKey && master
      ? `/admin/mastering?source=${encodeURIComponent(remixKey)}&title=${encodeURIComponent(
          `${master.title || 'Untitled'} — remix`
        )}&target=${encodeURIComponent(String(master.target))}`
      : null;

  const majorityRate = set ? majoritySampleRate(set) : null;
  const longest = set ? longestDuration(set) : null;
  const now = Date.now();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/mastering"
          className="text-sm text-orange-600 hover:underline dark:text-orange-400"
        >
          ← Sound Engineering
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-800 dark:text-gray-100">
          {master?.title || 'Untitled'}
        </h1>
      </div>

      {loadError && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {loadError}
        </p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">Add stems</h2>
        {/* Only once we actually have a master to attach stems to — a 404
            or other load failure must not offer an upload area that would
            orphan whatever gets dropped into it. */}
        {master && <StemUpload masterJobId={masterJobId} onAdded={handleAdded} />}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">Stems</h2>
        {!set || set.order.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No stems yet — drop the song&apos;s stem WAVs above.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {set.order.map((id) => {
              const stem = set.stems[id];
              if (!stem) return null;
              const rateMismatch =
                stem.sampleRate != null && majorityRate != null && stem.sampleRate !== majorityRate
                  ? `${formatRate(stem.sampleRate)} — ${
                      majorityRate === 48000 ? 'will be resampled to 48 kHz' : 'differs from the others'
                    }`
                  : null;
              const shortfall =
                stem.durationSec != null && longest != null && longest - stem.durationSec > 0.1
                  ? `shorter by ${formatSeconds(longest - stem.durationSec)}s — padded with silence when mixed`
                  : null;
              const isRenaming = renaming === id;
              const rowAlert = rowError?.stemId === id ? rowError.message : null;

              return (
                <li key={id} aria-label={stem.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-sm">
                  {isRenaming ? (
                    <input
                      aria-label="Stem name"
                      autoFocus
                      maxLength={80}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void submitRename(id);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      className="min-w-0 grow rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
                    />
                  ) : (
                    <span className="min-w-0 grow truncate font-medium text-gray-800 dark:text-gray-100">
                      {stem.name}
                    </span>
                  )}

                  {!isRenaming && (
                    <button
                      type="button"
                      aria-label={`Rename ${stem.name}`}
                      onClick={() => startRename(id, stem.name)}
                      className="flex shrink-0 items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Rename
                    </button>
                  )}

                  {stem.durationSec != null && (
                    <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                      {formatClock(Math.round(stem.durationSec))}
                    </span>
                  )}
                  {stem.sampleRate != null && (
                    <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                      {formatRate(stem.sampleRate)}
                    </span>
                  )}
                  {rateMismatch && (
                    <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">{rateMismatch}</span>
                  )}
                  {shortfall && (
                    <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">{shortfall}</span>
                  )}

                  {stem.previewError ? (
                    <>
                      <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">
                        {stem.previewError}
                      </p>
                      <button
                        type="button"
                        aria-label={`Retry ${stem.name}`}
                        onClick={() => void retryPreview(id, stem)}
                        className="flex shrink-0 items-center gap-1 text-xs font-medium text-orange-600 hover:underline dark:text-orange-400"
                      >
                        <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
                      </button>
                    </>
                  ) : stem.previewKey === null && isStalePending(stem, now) ? (
                    <>
                      <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">
                        Taking longer than expected — press Retry.
                      </p>
                      <button
                        type="button"
                        aria-label={`Retry ${stem.name}`}
                        onClick={() => void retryPreview(id, stem)}
                        className="flex shrink-0 items-center gap-1 text-xs font-medium text-orange-600 hover:underline dark:text-orange-400"
                      >
                        <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
                      </button>
                    </>
                  ) : stem.previewKey === null ? (
                    <span className="shrink-0 text-xs text-gray-400">Preparing listening copy…</span>
                  ) : playUrls[id] ? (
                    <audio controls src={playUrls[id]} className="h-8 shrink-0" />
                  ) : (
                    <button
                      type="button"
                      aria-label={`Play ${stem.name}`}
                      disabled={playLoading === id}
                      onClick={() => void playStem(id, stem.previewKey!)}
                      className="flex shrink-0 items-center gap-1 text-xs font-medium text-orange-600 hover:underline disabled:opacity-50 dark:text-orange-400"
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" /> Play
                    </button>
                  )}

                  <button
                    type="button"
                    aria-label={`Download ${stem.name}`}
                    onClick={() => void downloadStem(id, stem)}
                    className="flex shrink-0 items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${stem.name}`}
                    onClick={() => void removeStem(id, stem.name)}
                    className="flex shrink-0 items-center gap-1 text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                  </button>

                  {rowAlert && (
                    <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">
                      {rowAlert}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {set && set.order.length > 0 && (
        <StemMixer set={set} masterJobId={masterJobId} onMixChange={handleMixChange} />
      )}

      {set && set.order.length > 0 && (
        <section
          aria-label="Remix"
          className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Remix</h2>
            <button
              type="button"
              disabled={renderBusy}
              onClick={() => void handleRender()}
              className="rounded-md border border-orange-300 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/30"
            >
              {renderBusy ? 'Rendering…' : 'Render remix'}
            </button>
          </div>

          {renderError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {renderError}
            </p>
          )}

          {set.remix?.key && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Remix ready</p>
              {set.remix.notes.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-gray-500 dark:text-gray-400">
                  {set.remix.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}
              {remixPlayUrl && <audio controls src={remixPlayUrl} className="h-8" />}
              {remixMasterHref && (
                <Link
                  href={remixMasterHref}
                  className="block text-xs font-medium text-orange-600 hover:underline dark:text-orange-400"
                >
                  Master this remix
                </Link>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
