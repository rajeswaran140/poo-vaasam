/**
 * How far a visual story has got — one computation shared by the studio's
 * steps bar and the story list's cards, so the two never disagree.
 * Client-safe and pure.
 */

import type { Candidate, RenderJob, Shot, VisualStory } from '@/types/visualStory';

export interface StoryProgress {
  shotCount: number;
  /** Shots whose chosen picture or clip still exists. */
  readyCount: number;
  /** Seconds the shots add up to, against the story's window. */
  filledSec: number;
  windowSec: number;
  render: 'none' | 'running' | 'done' | 'failed';
  /** The newest finished video, for the list's badge. */
  videoKey: string | null;
  /** A picture to show for the story: the first shot's chosen still. */
  coverKey: string | null;
}

export function storyProgress(tree: {
  story: Pick<VisualStory, 'windowStartSec' | 'windowEndSec'>;
  shots: Shot[];
  candidates: Candidate[];
  renders?: RenderJob[];
}): StoryProgress {
  const chosenOf = (s: Shot) =>
    s.selectedCandidateId ? tree.candidates.find((c) => c.candId === s.selectedCandidateId) ?? null : null;
  const newest = [...(tree.renders ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = newest[0];
  const firstStill = tree.shots.map(chosenOf).find((c) => c && c.mode === 'STILL') ?? null;
  return {
    shotCount: tree.shots.length,
    readyCount: tree.shots.filter((s) => chosenOf(s) !== null).length,
    filledSec: tree.shots.reduce((n, s) => n + s.durationSec, 0),
    windowSec: tree.story.windowEndSec - tree.story.windowStartSec,
    render: !latest
      ? 'none'
      : latest.status === 'queued' || latest.status === 'running'
        ? 'running'
        : latest.status === 'done'
          ? 'done'
          : 'failed',
    videoKey: newest.find((r) => r.status === 'done' && r.s3Key)?.s3Key ?? null,
    coverKey: firstStill?.s3Key ?? null,
  };
}

export type StepState = 'done' | 'current' | 'todo';

export interface Step {
  label: string;
  detail: string;
  state: StepState;
}

export const mmss = (sec: number) => {
  // Rounded first, so 59.6 s reads 1:00, never 0:60.
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The four steps from an empty story to a finished video. The first step not
 * done is "current" — the one to do next; the ones after it are "todo".
 */
export function storySteps(p: StoryProgress): Step[] {
  const raw: Array<Omit<Step, 'state'> & { done: boolean }> = [
    {
      label: 'Storyboard',
      detail: p.shotCount ? `${p.shotCount} ${p.shotCount === 1 ? 'shot' : 'shots'}` : 'Draft it from the lyrics, or add shots',
      done: p.shotCount > 0,
    },
    {
      label: 'Fill the song',
      detail: `${mmss(p.filledSec)} of ${mmss(p.windowSec)}`,
      done: p.shotCount > 0 && p.filledSec === p.windowSec,
    },
    {
      label: 'Choose pictures or clips',
      detail: `${p.readyCount} of ${p.shotCount} shots`,
      done: p.shotCount > 0 && p.readyCount === p.shotCount,
    },
    {
      label: 'Render video',
      detail: p.render === 'done' ? 'Finished' : p.render === 'running' ? 'Rendering…' : p.render === 'failed' ? 'Failed — try again' : 'Not yet',
      done: p.render === 'done',
    },
  ];
  const firstOpen = raw.findIndex((s) => !s.done);
  return raw.map(({ done, ...s }, i) => ({ ...s, state: done ? 'done' : i === firstOpen ? 'current' : 'todo' }));
}
