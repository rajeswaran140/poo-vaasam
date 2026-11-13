/** One rule for a made clip against its row: play as is, trim, slow (to 88 %), or out of date. */
import { clipFitFor, maxRowSecFor, MIN_PLAYBACK_RATE } from '@/lib/visual-story-clip-fit';

describe('clipFitFor', () => {
  it('trims a clip longer than its row', () => {
    expect(clipFitFor(14, 13.2)).toEqual({ kind: 'trim', trimSec: 0.8 });
  });
  it('slows a clip a little shorter than its row, to 3 decimals', () => {
    expect(clipFitFor(14, 15.2)).toEqual({ kind: 'slow', rate: 0.921 });
  });
  it('is out of date when the row needs it slower than 88 %', () => {
    expect(MIN_PLAYBACK_RATE).toBe(0.88);
    expect(clipFitFor(14, 16)).toEqual({ kind: 'stale' });
  });
  it('is exact to the hundredth', () => {
    expect(clipFitFor(14, 14)).toEqual({ kind: 'exact' });
    expect(clipFitFor(14.004, 14)).toEqual({ kind: 'exact' });
    // Grok's files run a frame long (14.04 s for 14 s): within one 25 fps frame is exact.
    expect(clipFitFor(14.04, 14)).toEqual({ kind: 'exact' });
    expect(clipFitFor(14.04, 13.9)).toEqual({ kind: 'trim', trimSec: 0.14 });
  });
  it('never trims a clip a chained row continues from (the seam would jump)', () => {
    expect(clipFitFor(14, 12.9, { continuedFrom: true })).toEqual({ kind: 'stale' });
    // Under a second is what Grok's whole seconds leave (a 13.2 s row gets a 14 s clip): trimmed, or it would be
    // made again, and paid for, on every run.
    expect(clipFitFor(14, 13.2, { continuedFrom: true })).toEqual({ kind: 'trim', trimSec: 0.8 });
    expect(clipFitFor(14, 15.2, { continuedFrom: true })).toEqual({ kind: 'slow', rate: 0.921 });
  });
  it('never trims or slows a clip whose length is unknown', () => {
    expect(clipFitFor(null, 14)).toEqual({ kind: 'exact' });
    expect(clipFitFor(null, 14.6)).toEqual({ kind: 'stale' });
    expect(clipFitFor(null, 13.2)).toEqual({ kind: 'stale' });
  });
  it('takes a stricter floor when asked (trim only)', () => {
    expect(clipFitFor(14, 15.2, { minRate: 1 })).toEqual({ kind: 'stale' });
  });
});

describe('maxRowSecFor', () => {
  it('is the longest row a clip fills at 88 %, floored to the tenth', () => {
    expect(maxRowSecFor(14)).toBe(15.9);
    expect(maxRowSecFor(14, 1)).toBe(14);
  });
});
