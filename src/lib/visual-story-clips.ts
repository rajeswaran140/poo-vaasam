/**
 * A visual story's clips as a Mastering background list — "Add clips from a
 * visual story". Client-safe. The keys are the story's own candidate files in
 * the mastering workspace, so nothing is copied or uploaded again.
 *
 * One clip per shot, in story order. A shot's chosen item is often its picture
 * (Make video does not choose the clip it makes), so a shot without a chosen
 * clip offers its newest clip, and says so in its name; a shot with no clip at
 * all is listed in `withoutClip`, never silently left out.
 */

import { assemblyKindOf, shotLabel } from '@/lib/visual-story-assemble';
import type { Candidate, Shot } from '@/types/visualStory';

export interface StoryClip {
  key: string;
  name: string;
  /** The shot's length — what the clip was made at. */
  seconds: number;
}

export function storyBackgroundClips(tree: {
  shots: Pick<Shot, 'sceneOrder' | 'shotOrder' | 'selectedCandidateId' | 'durationSec'>[];
  candidates: Pick<Candidate, 'candId' | 'sceneOrder' | 'shotOrder' | 's3Key' | 'createdAt'>[];
}): { clips: StoryClip[]; withoutClip: string[] } {
  const isClip = (c: { s3Key: string }) => assemblyKindOf(c.s3Key) === 'clip';
  const shots = [...tree.shots].sort((a, b) => a.sceneOrder - b.sceneOrder || a.shotOrder - b.shotOrder);
  const clips: StoryClip[] = [];
  const withoutClip: string[] = [];
  for (const s of shots) {
    const label = shotLabel(s);
    const chosen = tree.candidates.find((c) => c.candId === s.selectedCandidateId);
    if (chosen && isClip(chosen)) {
      clips.push({ key: chosen.s3Key, name: label, seconds: s.durationSec });
      continue;
    }
    const newest = tree.candidates
      .filter((c) => c.sceneOrder === s.sceneOrder && c.shotOrder === s.shotOrder && isClip(c))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (newest) clips.push({ key: newest.s3Key, name: `${label} (newest clip)`, seconds: s.durationSec });
    else withoutClip.push(label);
  }
  return { clips, withoutClip };
}
