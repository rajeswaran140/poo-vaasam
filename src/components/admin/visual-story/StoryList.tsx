'use client';

import { useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/client-auth';
import type { VisualStory } from '@/types/visualStory';
import { mmss, type StoryProgress } from '@/lib/visual-story-progress';
import { Thumb } from './ui-utils';

/**
 * The list endpoint adds each story's progress (storyProgress) for its card;
 * shotCount is null when that story could not be read.
 */
export type StoryRow = VisualStory & Partial<Omit<StoryProgress, 'shotCount'>> & { shotCount?: number | null };

const usd = (n: number) => `$${n.toFixed(2)}`;

/** One card per story: cover picture, shape and length, how ready it is, and a finished video. */
export function StoryList({ stories }: { stories: StoryRow[] }) {
  if (stories.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400">
        No stories yet. Start one from a saved master below.
      </p>
    );
  }
  return (
    <ul aria-label="Stories" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {stories.map((s) => {
        const known = typeof s.shotCount === 'number';
        const windowSec = s.windowSec ?? s.windowEndSec - s.windowStartSec;
        return (
          <li key={s.vsId}>
            <Link
              href={`/admin/visual-story/${s.vsId}`}
              className="flex gap-3 rounded-lg border border-gray-200 p-3 hover:border-blue-400 hover:bg-blue-50/40 dark:border-gray-700 dark:hover:border-blue-600 dark:hover:bg-blue-950/40"
            >
              <span className="shrink-0">
                {s.coverKey ? (
                  <Thumb s3Key={s.coverKey} alt="" aspect={s.aspectRatio} small />
                ) : (
                  <span
                    className={`${s.aspectRatio === '9:16' ? 'h-24 w-14' : 'h-14 w-24'} flex items-center justify-center rounded bg-gray-100 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400`}
                  >
                    {s.aspectRatio}
                  </span>
                )}
              </span>
              <span className="min-w-0 space-y-0.5 text-sm">
                <span className="block truncate font-medium text-blue-700 dark:text-blue-400">{s.title}</span>
                <span className="block text-gray-600 dark:text-gray-400">{`${s.aspectRatio} · ${mmss(windowSec)} of song`}</span>
                <span className="block text-gray-700 dark:text-gray-300">
                  {!known
                    ? 'Shots —'
                    : s.shotCount === 0
                      ? 'No shots yet'
                      : `${s.readyCount ?? 0} of ${s.shotCount} ${s.shotCount === 1 ? 'shot' : 'shots'} ready`}
                </span>
                {/* Any finished video counts, even if a later re-render failed. */}
                {s.videoKey && (
                  <span className="inline-block rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                    Video ready
                  </span>
                )}
                {s.render === 'running' && (
                  <span className="inline-block rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    Rendering…
                  </span>
                )}
                <span className="block text-xs text-gray-500 dark:text-gray-400">{`${usd(s.spentUsd)} of ${usd(s.budgetUsdCap)} spent`}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "Check rendering videos (N)" — runs the reconcile sweep, ONLY when pressed
 * (owner's decision: never on page load). Result and error show beside it;
 * the list is refreshed either way.
 */
export function ReconcileButton({ count, onDone }: { count: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (count <= 0 && !result && !error) return null;

  const run = async () => {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/visual-story/reconcile', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'Could not check the videos.');
      const { finished, stillRunning } = body.data as { finished: number; stillRunning: number };
      setResult(`${finished} finished, ${stillRunning} still rendering`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the videos.');
    } finally {
      setBusy(false);
      // Always refresh: a sweep cut off by an error or timeout may still have
      // finished some clips before it stopped.
      onDone();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {count > 0 && (
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Checking…' : `Check rendering videos (${count})`}
        </button>
      )}
      {result && <span className="text-sm text-gray-700 dark:text-gray-300">{result}</span>}
      {error && (
        <span role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
