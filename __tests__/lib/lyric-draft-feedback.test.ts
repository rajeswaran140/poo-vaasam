/** @jest-environment node */
/** feedbackProgress — addressed vs remaining slack lines; pure, whitespace-tolerant. */

import { feedbackProgress } from '@/lib/lyric-draft-feedback';
import type { LyricCritique } from '@/services/ai/lyricCriticSchema';

const critique = (slack: { line: string; issue: string }[]): LyricCritique => ({
  overall: 'x',
  strengths: [],
  observations: [],
  slackLines: slack,
  wordIdeas: [],
  questions: [],
});

it('returns null when there is no prior critique or no slack lines', () => {
  expect(feedbackProgress(null, 'anything')).toBeNull();
  expect(feedbackProgress(critique([]), 'anything')).toBeNull();
});

it('counts a flagged line as addressed once it no longer appears verbatim', () => {
  const prev = critique([
    { line: 'மண்ணை தொடணும்', issue: 'too abstract' },
    { line: 'காற்று வீசுது', issue: 'filler' },
  ]);
  // The first line was reworked away; the second remains.
  const current = 'மண்ணின் வாசம்\nகாற்று வீசுது';
  const p = feedbackProgress(prev, current)!;
  expect(p.total).toBe(2);
  expect(p.addressed).toBe(1);
  expect(p.remaining).toEqual([{ line: 'காற்று வீசுது', issue: 'filler' }]);
});

it('ignores trivial whitespace differences (still counts as present)', () => {
  const prev = critique([{ line: 'மண்ணை தொடணும்', issue: 'abstract' }]);
  const p = feedbackProgress(prev, '  மண்ணை   தொடணும்  ')!;
  expect(p.addressed).toBe(0);
  expect(p.remaining).toHaveLength(1);
});

it('reports all addressed when every flagged line is gone', () => {
  const prev = critique([{ line: 'old line', issue: 'weak' }]);
  const p = feedbackProgress(prev, 'a wholly new draft')!;
  expect(p).toMatchObject({ total: 1, addressed: 1, remaining: [] });
});
