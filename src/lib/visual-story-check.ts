/**
 * Storyboard check — the parts both sides need: what is sent to Claude (so
 * the panel can price the button from the same message the worker sends) and
 * the filter that drops issues pointing at shots that do not exist.
 *
 * Client-safe and pure.
 */

import type { AspectRatio, Character, CheckIssue, Scene, Shot } from '@/types/visualStory';

export const MAX_CHECK_ISSUES = 30;

/** What is checked: the storyboard as the owner sees it, characters by name. */
export interface CheckInput {
  aspectRatio: AspectRatio;
  windowSec: number;
  style: string;
  characters: Array<{ name: string; description: string }>;
  scenes: Array<{
    order: number;
    heading: string;
    summary: string;
    shots: Array<{ shotOrder: number; startSec: number; durationSec: number; mode: string; visualPrompt: string; characters: string[] }>;
  }>;
}

export function buildCheckInput(tree: {
  story: { aspectRatio: AspectRatio; windowStartSec: number; windowEndSec: number; style?: string };
  scenes: Scene[];
  shots: Shot[];
  characters: Character[];
}): CheckInput {
  const nameOf = new Map(tree.characters.map((c) => [c.charId, c.name]));
  const scenes = [...tree.scenes].sort((a, b) => a.order - b.order);
  return {
    aspectRatio: tree.story.aspectRatio,
    windowSec: tree.story.windowEndSec - tree.story.windowStartSec,
    style: (tree.story.style ?? '').trim(),
    characters: tree.characters.map((c) => ({ name: c.name, description: c.description })),
    scenes: scenes.map((sc) => ({
      order: sc.order,
      heading: sc.heading,
      summary: sc.summary,
      shots: tree.shots
        .filter((s) => s.sceneOrder === sc.order)
        .sort((a, b) => a.shotOrder - b.shotOrder)
        .map((s) => ({
          shotOrder: s.shotOrder,
          startSec: s.startSec,
          durationSec: s.durationSec,
          mode: s.mode,
          visualPrompt: s.visualPrompt,
          characters: s.charIds.map((id) => nameOf.get(id)).filter((n): n is string => !!n),
        })),
    })),
  };
}

/** The user message: the storyboard as JSON, then the lyrics when given. */
export function buildCheckMessage(input: CheckInput, lyrics?: string): string {
  const words = (lyrics ?? '').trim();
  return [
    'Storyboard (JSON):',
    JSON.stringify(input),
    '',
    words ? `Lyrics:\n${words}` : 'No lyrics were given: skip the lyrics kind.',
  ].join('\n');
}

/** Drop issues that point at a scene or shot the storyboard does not have. */
export function keepKnownIssues(input: CheckInput, issues: CheckIssue[]): CheckIssue[] {
  return issues.filter((i) => {
    const scene = input.scenes.find((s) => s.order === i.sceneOrder);
    if (!scene) return false;
    return i.shotOrder === null || scene.shots.some((s) => s.shotOrder === i.shotOrder);
  });
}
