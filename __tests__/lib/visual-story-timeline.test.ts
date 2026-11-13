/** Row seconds in tenths: the timeline helpers must not drift on float sums. */
import { deriveStartSecs, isTenth, roundTenth, sameSec, tilesWindow } from '@/types/visualStory';

describe('timeline in tenths', () => {
  it('tilesWindow accepts tenths whose float sum is 179.99999…', () => {
    const rows = [...Array(12)].map(() => ({ durationSec: 13.9 })).concat({ durationSec: 13.2 });
    expect(rows.reduce((n, r) => n + r.durationSec, 0)).not.toBe(180);
    expect(tilesWindow(rows, 180)).toBe(true);
    expect(tilesWindow(rows.slice(1), 180)).toBe(false);
  });
  it('deriveStartSecs gives starts rounded to the hundredth', () => {
    expect(deriveStartSecs([{ durationSec: 14.9 }, { durationSec: 15 }, { durationSec: 13.2 }])).toEqual([0, 14.9, 29.9]);
  });
  it('isTenth, roundTenth, sameSec', () => {
    expect(isTenth(14.9)).toBe(true);
    expect(isTenth(14)).toBe(true);
    expect(isTenth(14.95)).toBe(false);
    expect(roundTenth(14.94)).toBe(14.9);
    expect(sameSec(179.99999999, 180)).toBe(true);
    expect(sameSec(179.98, 180)).toBe(false);
  });
});
