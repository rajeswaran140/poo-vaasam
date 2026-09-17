'use client';

/**
 * The state of one saved master, in a line.
 *
 * Replaces inference. The row used to show a set of download links from which
 * the operator worked out where a song had got to — an MP3 link meant it had
 * been encoded, and whether it had reached YouTube was not shown at all. That
 * cost a wasted 3-minute render on a song already scheduled to premiere.
 *
 * ⚠️ IT DECIDES NOTHING. Every judgement comes from `release-pipeline`, which
 * delegates in turn to the planners the buttons use. A status line that
 * disagrees with the control beside it teaches the operator to distrust the
 * screen, which is worse than showing nothing.
 */

import { CircleDot, Circle, ArrowRight, ExternalLink } from 'lucide-react';
import { pipelineFor, nextAction } from '@/lib/release-pipeline';
import type { MasterJob } from '@/types/masterJob';

export function ReleasePipelineRow({ job }: { job: MasterJob }) {
  const stages = pipelineFor(job);
  const next = nextAction(job);

  return (
    <div className="mt-1 flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {stages.map((s) => (
          <span
            key={s.id}
            className={
              s.done
                ? 'inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400'
                : 'inline-flex items-center gap-1 text-gray-400 dark:text-gray-600'
            }
          >
            {s.done
              ? <CircleDot className="h-3 w-3" aria-hidden="true" />
              : <Circle className="h-3 w-3" aria-hidden="true" />}
            {s.label}
          </span>
        ))}
      </span>

      {next && (
        <span
          className={
            next.external
              ? 'inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              : 'inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200'
          }
        >
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
          {next.label}
          {/* Says plainly that the remaining step is not in this portal — the
              panel must never imply a release is finished when it is not. */}
          {next.external && <ExternalLink className="h-3 w-3" aria-hidden="true" />}
        </span>
      )}
    </div>
  );
}
