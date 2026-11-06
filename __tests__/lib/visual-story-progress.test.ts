/** @jest-environment node */
/** How far a story has got — shared by the steps bar and the story cards. */
import { mmss, storyProgress, storySteps } from '@/lib/visual-story-progress';
import type { Candidate, RenderJob, Shot } from '@/types/visualStory';

const shot = (shotOrder: number, durationSec: number, selectedCandidateId: string | null) =>
  ({ sceneOrder: 1, shotOrder, durationSec, selectedCandidateId }) as Shot;
const cand = (candId: string, mode: 'STILL' | 'HERO') => ({ candId, mode, s3Key: `k/${candId}` }) as Candidate;
const render = (status: RenderJob['status'], createdAt: string, s3Key?: string) => ({ renderId: createdAt, status, createdAt, s3Key }) as RenderJob;
const story = { windowStartSec: 10, windowEndSec: 40 };

describe('storyProgress', () => {
  it('counts ready shots, filled seconds, the cover and the newest finished video', () => {
    const p = storyProgress({
      story,
      shots: [shot(1, 10, 'clip'), shot(2, 10, 'pic'), shot(3, 5, null), shot(4, 5, 'gone')],
      candidates: [cand('clip', 'HERO'), cand('pic', 'STILL')],
      renders: [render('done', '2026-11-06T01:00:00Z', 'old.mp4'), render('failed', '2026-11-06T02:00:00Z')],
    });
    expect(p).toEqual({
      shotCount: 4, readyCount: 2, filledSec: 30, windowSec: 30,
      render: 'failed', videoKey: 'old.mp4', coverKey: 'k/pic',
    });
  });

  it('an empty story has nothing', () => {
    expect(storyProgress({ story, shots: [], candidates: [] })).toMatchObject({
      shotCount: 0, readyCount: 0, render: 'none', videoKey: null, coverKey: null,
    });
  });
});

describe('storySteps', () => {
  const states = (s: ReturnType<typeof storySteps>) => s.map((x) => x.state);

  it('an empty story: storyboard is the next step, the rest wait', () => {
    expect(states(storySteps(storyProgress({ story, shots: [], candidates: [] })))).toEqual(['current', 'todo', 'todo', 'todo']);
  });

  it('shots that do not fill the song: that is the next step', () => {
    const steps = storySteps(storyProgress({ story, shots: [shot(1, 20, 'pic')], candidates: [cand('pic', 'STILL')] }));
    expect(states(steps)).toEqual(['done', 'current', 'done', 'todo']);
    expect(steps[1].detail).toBe('0:20 of 0:30');
  });

  it('everything chosen and filled: render is next; finished: all done', () => {
    const base = { story, shots: [shot(1, 30, 'pic')], candidates: [cand('pic', 'STILL')] };
    expect(states(storySteps(storyProgress(base)))).toEqual(['done', 'done', 'done', 'current']);
    const finished = storySteps(storyProgress({ ...base, renders: [render('done', '2026-11-06T01:00:00Z', 'v.mp4')] }));
    expect(states(finished)).toEqual(['done', 'done', 'done', 'done']);
    expect(finished[3].detail).toBe('Finished');
  });
});

describe('edge cases', () => {
  it('an over-filled song is not done, and says by how much', () => {
    const steps = storySteps(storyProgress({ story, shots: [shot(1, 40, null)], candidates: [] }));
    expect(steps[1]).toMatchObject({ state: 'current', detail: '0:40 of 0:30' });
  });
  it('never prints 0:60', () => {
    expect(mmss(59.6)).toBe('1:00');
    expect(mmss(125)).toBe('2:05');
  });
});
