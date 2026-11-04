'use client';

import Link from 'next/link';
import type { VisualStory } from '@/types/visualStory';

/** The list endpoint returns METADATA only; shotCount is shown when a caller supplies it. */
export type StoryRow = VisualStory & { shotCount?: number };

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
