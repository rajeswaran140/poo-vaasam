'use client';

/** Bottom bar: spend against the cap, how much of the window the shots fill, and how many have a chosen image. */

import type { Shot, VisualStory } from '@/types/visualStory';
import { usd } from './ShotCard';

export function SpendBar({ story, shots }: { story: VisualStory; shots: Shot[] }) {
  const windowSec = story.windowEndSec - story.windowStartSec;
  const totalSec = shots.reduce((t, s) => t + s.durationSec, 0);
  const tiles = totalSec === windowSec;
  const chosen = shots.filter((s) => s.selectedCandidateId).length;
  const cap = story.budgetUsdCap;
  const pct = (n: number) => (cap > 0 ? Math.min(100, (n / cap) * 100) : 100);

  return (
    <footer aria-label="Spend and timeline" className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-200 bg-white px-4 py-3 text-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="min-w-[16rem] space-y-1">
        <p className="text-gray-800 dark:text-gray-200">{`${usd(story.spentUsd)} spent + ${usd(story.reservedUsd)} reserved of ${usd(cap)}`}</p>
        <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
          <div className="bg-blue-600" style={{ width: `${pct(story.spentUsd)}%` }} />
          <div className="bg-amber-500" style={{ width: `${pct(story.reservedUsd)}%` }} />
        </div>
      </div>
      <p className={tiles ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}>
        <span>{`Shots fill ${totalSec} of ${windowSec} s`}</span>
        {!tiles && <span className="text-gray-600 dark:text-gray-400">{' — they must fill the window exactly to render'}</span>}
      </p>
      <p className="text-gray-700 dark:text-gray-300">{`${chosen} of ${shots.length} shots have a chosen image`}</p>
    </footer>
  );
}
