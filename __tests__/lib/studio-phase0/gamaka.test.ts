/** @jest-environment node */
import { smoothCurve, curveForNote } from '@/lib/studio-phase0/gamaka';

describe('smoothCurve', () => {
  it('keeps the length and both endpoints', () => {
    const out = smoothCurve([0, 10, 20, 30, 40], 3);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(40);
  });

  it('flattens a single spike', () => {
    const out = smoothCurve([0, 0, 0, 90, 0, 0, 0], 3);
    expect(out[3]).toBeCloseTo(30, 5);
    expect(Math.max(...out)).toBeLessThan(90);
  });

  it('leaves a curve unchanged with a window of 1', () => {
    expect(smoothCurve([5, -5, 5], 1)).toEqual([5, -5, 5]);
  });
});

describe('curveForNote', () => {
  const note = { t: 0, dur: 1, midi: 60, vel: 100 };
  it('returns null without a curve, or with fewer than 2 points', () => {
    expect(curveForNote(note)).toBeNull();
    expect(curveForNote({ ...note, detuneCurve: [12] })).toBeNull();
  });
  it('returns the curve as a Float32Array', () => {
    expect(Array.from(curveForNote({ ...note, detuneCurve: [0, 50, 100] })!)).toEqual([0, 50, 100]);
  });
});
