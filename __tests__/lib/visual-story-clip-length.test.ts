/** @jest-environment node */
/** Your own clip's row length: the clip's own duration, rounded to a whole second, 1–60 s. */
import { clipRowSeconds } from '@/lib/visual-story-clip-length';

describe('clipRowSeconds', () => {
  it.each([
    [7.6, 8],
    [7.4, 7],
    [15.04, 15],
    [0.3, 1],
    [59.6, 60],
  ])('%s s → %s s', (d, s) => {
    expect(clipRowSeconds(d)).toEqual({ ok: true, seconds: s });
  });
  it('refuses a clip longer than 60 s, naming its length', () => {
    expect(clipRowSeconds(75)).toEqual({ ok: false, error: 'The clip is 75 s long; the most for one clip is 60 s.' });
  });
  it.each([NaN, 0, -1, Infinity])('refuses an unreadable length (%s)', (d) => {
    expect(clipRowSeconds(d)).toMatchObject({ ok: false, error: expect.stringMatching(/Could not read how long/) });
  });
});
