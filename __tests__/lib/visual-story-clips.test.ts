/**
 * A story's clips as a background list, for the Mastering panel: one per
 * shot, in story order. A shot's chosen item is often its PICTURE (Make video
 * does not choose the clip it makes), so a shot with no chosen clip offers its
 * newest one — named so on screen — and a shot with no clip at all is listed,
 * never silently dropped.
 */
import { storyBackgroundClips } from '@/lib/visual-story-clips';
import type { Candidate, Shot } from '@/types/visualStory';

const P = 'audio/mastering/visual-story/vs_a/candidates/';
const shot = (sceneOrder: number, shotOrder: number, selectedCandidateId: string | null, durationSec = 8) =>
  ({ sceneOrder, shotOrder, selectedCandidateId, durationSec }) as Shot;
const cand = (candId: string, sceneOrder: number, shotOrder: number, ext: string, createdAt: string) =>
  ({ candId, sceneOrder, shotOrder, s3Key: `${P}${candId}.${ext}`, createdAt }) as Candidate;

it('takes each shot in story order: its chosen clip, else its newest clip, else lists it as missing', () => {
  const shots = [shot(2, 1, 'c_pic2', 15), shot(1, 2, null, 6), shot(1, 1, 'c_clip1', 10)];
  const candidates = [
    cand('c_clip1', 1, 1, 'mp4', '2026-11-06T01:00:00Z'),
    cand('c_clip1b', 1, 1, 'mp4', '2026-11-06T09:00:00Z'),
    cand('c_pic2', 2, 1, 'jpg', '2026-11-06T01:00:00Z'),
    cand('c_old2', 2, 1, 'mp4', '2026-11-06T02:00:00Z'),
    cand('c_new2', 2, 1, 'mp4', '2026-11-06T05:00:00Z'),
  ];
  expect(storyBackgroundClips({ shots, candidates })).toEqual({
    clips: [
      { key: `${P}c_clip1.mp4`, name: 'Scene 1, shot 1', seconds: 10 },
      { key: `${P}c_new2.mp4`, name: 'Scene 2, shot 1 (newest clip)', seconds: 15 },
    ],
    withoutClip: ['Scene 1, shot 2'],
  });
});

it('an empty story has nothing to add', () => {
  expect(storyBackgroundClips({ shots: [], candidates: [] })).toEqual({ clips: [], withoutClip: [] });
});
