/** @jest-environment node */
/**
 * Pure helpers behind the canvas waveform scrubber on /admin/mastering.
 *
 * The drawing itself is canvas work and is verified by eye; what is testable —
 * and what breaks silently if it regresses — is the arithmetic that decides
 * WHERE a bar goes, HOW MANY there are, what a screen reader announces, and
 * where a key press lands the playhead.
 */
import {
  resamplePeaks,
  bucketsForWidth,
  describePosition,
  seekTargetForKey,
  SEEK_STEP_SECONDS,
  SEEK_PAGE_SECONDS,
} from '@/lib/waveform';

describe('resamplePeaks', () => {
  it('returns exactly the requested number of buckets', () => {
    expect(resamplePeaks([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 3)).toHaveLength(3);
    expect(resamplePeaks(Array(1200).fill(0.5), 317)).toHaveLength(317);
  });

  it('takes the MAX of each span, not the mean', () => {
    // A short transient is the thing you are hunting on a mastering player;
    // averaging would bury it.
    expect(resamplePeaks([0, 0, 1, 0], 2)).toEqual([0, 1]);
    expect(resamplePeaks([0.1, 0.9, 0.1, 0.1], 2)).toEqual([0.9, 0.1]);
  });

  it('upsamples without dropping the peak', () => {
    const out = resamplePeaks([0.2, 1], 4);
    expect(out).toHaveLength(4);
    expect(Math.max(...out)).toBe(1);
  });

  it('is a copy, not the same array, when lengths already match', () => {
    const src = [0.1, 0.2];
    const out = resamplePeaks(src, 2);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });

  it('never throws on degenerate input — a zero-width canvas must not crash', () => {
    expect(resamplePeaks([], 10)).toEqual([]);
    expect(resamplePeaks([0.5], 0)).toEqual([]);
    expect(resamplePeaks([0.5], -3)).toEqual([]);
    expect(resamplePeaks([0.5], 2.7)).toHaveLength(2); // floored
  });
});

describe('bucketsForWidth', () => {
  it('gives one bar per 3px', () => {
    expect(bucketsForWidth(300)).toBe(100);
    expect(bucketsForWidth(301)).toBe(100);
  });

  it('clamps to zero rather than going negative', () => {
    expect(bucketsForWidth(0)).toBe(0);
    expect(bucketsForWidth(-50)).toBe(0);
  });
});

describe('describePosition — what a screen reader actually says', () => {
  it('reads as a sentence, not a bare number', () => {
    // formatTime is the existing shipped convention — minutes are not padded.
    expect(describePosition(73, 228)).toBe('1:13 of 3:48');
  });

  it('handles the start and an unknown duration', () => {
    expect(describePosition(0, 0)).toBe('0:00 of 0:00');
  });
});

describe('seekTargetForKey', () => {
  it('steps by 5s on arrows and 30s on page keys', () => {
    expect(seekTargetForKey('ArrowRight', 100, 300)).toBe(100 + SEEK_STEP_SECONDS);
    expect(seekTargetForKey('ArrowLeft', 100, 300)).toBe(100 - SEEK_STEP_SECONDS);
    expect(seekTargetForKey('PageUp', 100, 300)).toBe(100 + SEEK_PAGE_SECONDS);
    expect(seekTargetForKey('PageDown', 100, 300)).toBe(100 - SEEK_PAGE_SECONDS);
  });

  it('Home and End are absolute', () => {
    expect(seekTargetForKey('Home', 100, 300)).toBe(0);
    expect(seekTargetForKey('End', 100, 300)).toBe(300);
  });

  it('clamps at both ends rather than seeking out of bounds', () => {
    expect(seekTargetForKey('ArrowLeft', 2, 300)).toBe(0);
    expect(seekTargetForKey('PageDown', 10, 300)).toBe(0);
    expect(seekTargetForKey('ArrowRight', 299, 300)).toBe(300);
    expect(seekTargetForKey('PageUp', 299, 300)).toBe(300);
  });

  it('returns null for keys it does not own, so the caller can leave them alone', () => {
    // The player region above also listens for Space, M and L; swallowing every
    // key here would break marking and play/pause while the waveform has focus.
    for (const k of [' ', 'm', 'M', 'l', 'L', 'Tab', 'a', '5']) {
      expect(seekTargetForKey(k, 100, 300)).toBeNull();
    }
  });

  it('survives a zero duration without producing NaN', () => {
    expect(seekTargetForKey('ArrowRight', 0, 0)).toBe(0);
    expect(seekTargetForKey('End', 0, 0)).toBe(0);
  });
});
