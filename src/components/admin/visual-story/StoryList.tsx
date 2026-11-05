'use client';

import { useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/client-auth';
import type { VisualStory } from '@/types/visualStory';

/** The list endpoint adds shotCount per story (R11); it is null when that story's count query failed. */
export type StoryRow = VisualStory & { shotCount?: number | null };

const usd = (n: number) => `$${n.toFixed(2)}`;

export function StoryList({ stories }: { stories: StoryRow[] }) {
  if (stories.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400">
        No stories yet. Start one from a saved master below.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          <tr>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Aspect</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Shots</th>
            <th className="px-3 py-2">Spent</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {stories.map((s) => (
            <tr key={s.vsId}>
              <td className="px-3 py-2">
                <Link href={`/admin/visual-story/${s.vsId}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">
                  {s.title}
                </Link>
              </td>
              <td className="px-3 py-2">{s.aspectRatio}</td>
              <td className="px-3 py-2">{s.status}</td>
              <td className="px-3 py-2">{s.shotCount ?? '—'}</td>
              <td className="px-3 py-2">{`${usd(s.spentUsd)} of ${usd(s.budgetUsdCap)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
