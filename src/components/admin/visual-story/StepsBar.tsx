'use client';

/**
 * The four steps from an empty story to a finished video, under the title:
 * what is done, what to do next, and how far each has got. Computed by
 * storySteps, which the story list's cards share.
 */

import type { StoryProgress } from '@/lib/visual-story-progress';
import { storySteps } from '@/lib/visual-story-progress';

const MARK = { done: '✓', current: '→', todo: '' } as const;

export function StepsBar({ progress }: { progress: StoryProgress }) {
  const steps = storySteps(progress);
  return (
    <ol aria-label="Steps" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {steps.map((s, i) => (
        <li
          key={s.label}
          aria-current={s.state === 'current' ? 'step' : undefined}
          className={`rounded-md border px-3 py-2 text-sm ${
            s.state === 'done'
              ? 'border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
              : s.state === 'current'
                ? 'border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-600 dark:bg-blue-950 dark:text-blue-200'
                : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400'
          }`}
        >
          <span className="font-medium">
            {`${i + 1}. ${s.label}`} {MARK[s.state] && <span aria-hidden="true">{MARK[s.state]}</span>}
          </span>
          <span className="block text-xs">{s.detail}</span>
          {s.state !== 'todo' && <span className="sr-only">{s.state === 'done' ? 'Done.' : 'Next step.'}</span>}
        </li>
      ))}
    </ol>
  );
}
