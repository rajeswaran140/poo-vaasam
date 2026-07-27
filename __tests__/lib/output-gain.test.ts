/** @jest-environment node */
/**
 * The compare player's volume curve. Pure, so it is tested directly rather than
 * through the component.
 */
import { outputGain } from '@/components/admin/MasteringComparePlayer';

describe('outputGain', () => {
  it('is silent at 0 and unity at 1', () => {
    expect(outputGain(0)).toBe(0);
    expect(outputGain(1)).toBe(1);
  });

  /**
   * Never above unity. The slider only attenuates: boosting past 1 could push
   * an already peak-safe master into clipping during the comparison and make
   * the master sound worse than it is.
   */
  it('never exceeds unity, even for out-of-range input', () => {
    expect(outputGain(2)).toBe(1);
    expect(outputGain(99)).toBe(1);
  });

  it('clamps negatives to silence rather than inverting phase', () => {
    expect(outputGain(-0.5)).toBe(0);
    expect(outputGain(-99)).toBe(0);
  });

  it('is squared, so mid-travel is well below half gain (perceptual curve)', () => {
    expect(outputGain(0.5)).toBeCloseTo(0.25, 5);
    expect(outputGain(0.25)).toBeCloseTo(0.0625, 5);
  });

  it('is monotonic across the travel', () => {
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const g = outputGain(p);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});
