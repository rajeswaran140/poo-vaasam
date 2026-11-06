'use client';

/**
 * The whole song at a glance: every shot in order, its width proportional to
 * its length, showing the chosen picture (or "Clip"), and an amber gap where
 * nothing is chosen yet. Pressing a shot opens it, like Edit on its card.
 */

import type { AspectRatio, Candidate, Shot } from '@/types/visualStory';
import { shotKey, Thumb } from './ui-utils';

/** Pixels per second of shot, with a floor so a 1 s shot is still pressable. */
const PX_PER_SEC = 10;
const MIN_PX = 48;

interface Props {
  shots: Shot[];
  candidates: Candidate[];
  aspect: AspectRatio;
  selectedKey: string | null;
  onOpen: (shot: Shot) => void;
}

export function TimelineStrip({ shots, candidates, aspect, selectedKey, onOpen }: Props) {
  if (shots.length === 0) return null;
  const height = aspect === '9:16' ? 'h-20' : 'h-12';
  return (
    <nav aria-label="Song timeline" className="overflow-x-auto pb-1">
      <ol className="flex min-w-max gap-1">
        {shots.map((s) => {
          const chosen = s.selectedCandidateId ? candidates.find((c) => c.candId === s.selectedCandidateId) : undefined;
          const kind = !chosen ? 'nothing chosen' : chosen.mode === 'STILL' ? 'picture chosen' : 'clip chosen';
          const key = shotKey(s);
          return (
            <li key={key} style={{ width: Math.max(MIN_PX, s.durationSec * PX_PER_SEC) }}>
              <button
                type="button"
                onClick={() => onOpen(s)}
                aria-label={`Scene ${s.sceneOrder}, shot ${s.shotOrder}, ${s.durationSec} s, ${kind}`}
                aria-current={selectedKey === key ? 'true' : undefined}
                className={`block w-full overflow-hidden rounded border text-left ${
                  selectedKey === key ? 'border-blue-600 ring-2 ring-blue-600' : chosen ? 'border-gray-300 dark:border-gray-600' : 'border-dashed border-amber-500'
                }`}
              >
                <span className={`block ${height} w-full`}>
                  {chosen?.mode === 'STILL' ? (
                    <Thumb s3Key={chosen.s3Key} alt="" fill />
                  ) : chosen ? (
                    <span className="flex h-full items-center justify-center bg-gray-800 text-xs text-white">▶ Clip</span>
                  ) : (
                    <span className="flex h-full items-center justify-center bg-amber-50 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      Choose
                    </span>
                  )}
                </span>
                <span className="block truncate px-1 text-[11px] text-gray-600 dark:text-gray-400">{`${s.sceneOrder}.${s.shotOrder} · ${s.durationSec}s`}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
