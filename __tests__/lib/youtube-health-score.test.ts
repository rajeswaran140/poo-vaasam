/** @jest-environment node */
/**
 * Tests for src/lib/youtube-health-score.ts. Dimension scores + the weighted
 * overall are checked against hand-computed values; the reach dimension is
 * explicitly checked to be settle-safe (baseline → healthy, never tanked).
 */

import { computeChannelHealth, DEFAULT_BASELINE_VPD, type HealthInput } from '@/lib/youtube-health-score';

function input(o: Partial<HealthInput> = {}): HealthInput {
  return {
    recentViewsPerDay: 6000,
    viewsDeclining: false,
    longFormRetention: 45,
    netSubsPerDay: 25,
    subsToTier2: 72,
    daysSinceLastUpload: 6,
    ...o,
  };
}

const dim = (h: ReturnType<typeof computeChannelHealth>, key: string) =>
  h.dimensions.find((d) => d.key === key)!;

describe('computeChannelHealth — dimensions', () => {
  it('scores each dimension from the signals', () => {
    const h = computeChannelHealth(input());
    expect(dim(h, 'reach').score).toBe(68); // 60 + (1.2-1)*40
    expect(dim(h, 'satisfaction').score).toBe(90); // 45 * 2
    expect(dim(h, 'growth').score).toBe(100); // clamp(40 + 25*3)
    expect(dim(h, 'publishing').score).toBe(100); // 6d ≤ 9
  });

  it('reach is settle-safe: at baseline it scores healthy (60), not tanked', () => {
    const h = computeChannelHealth(input({ recentViewsPerDay: 5000 })); // ratio 1
    expect(dim(h, 'reach').score).toBe(60);
    expect(dim(h, 'reach').note).toMatch(/settle above baseline is normal/i);
    // even well below a past peak, staying above baseline stays >= healthy
    expect(computeChannelHealth(input({ recentViewsPerDay: 6500 })).dimensions.find((d) => d.key === 'reach')!.score)
      .toBeGreaterThanOrEqual(60);
  });

  it('a declining trend docks reach by 10', () => {
    expect(dim(computeChannelHealth(input({ viewsDeclining: true })), 'reach').score).toBe(58);
  });

  it('publishing decays with staleness', () => {
    expect(dim(computeChannelHealth(input({ daysSinceLastUpload: 12 })), 'publishing').score).toBe(80);
    expect(dim(computeChannelHealth(input({ daysSinceLastUpload: 18 })), 'publishing').score).toBe(60);
    expect(dim(computeChannelHealth(input({ daysSinceLastUpload: 25 })), 'publishing').score).toBe(40);
    expect(dim(computeChannelHealth(input({ daysSinceLastUpload: 40 })), 'publishing').score).toBe(20);
  });
});

describe('computeChannelHealth — overall', () => {
  it('weights the measurable dimensions', () => {
    const h = computeChannelHealth(input());
    // .3*68 + .3*90 + .25*100 + .15*100 = 87.4 → 87
    expect(h.overall).toBe(87);
    expect(h.status).toBe('strong');
  });

  it('excludes unmeasurable dimensions and renormalizes', () => {
    const h = computeChannelHealth(input({ longFormRetention: null, netSubsPerDay: null }));
    // only reach(68,.3) + publishing(100,.15) → (.3*68 + .15*100)/.45 = 78.7 → 79
    expect(dim(h, 'satisfaction').score).toBeNull();
    expect(dim(h, 'growth').score).toBeNull();
    expect(h.overall).toBe(79);
  });

  it('maps overall to a status band', () => {
    expect(computeChannelHealth(input({ recentViewsPerDay: 2000, longFormRetention: 20, netSubsPerDay: 0, daysSinceLastUpload: 40 })).status)
      .toBe('concern');
    expect(computeChannelHealth(input()).status).toBe('strong');
  });

  it('headline names the strongest + weakest signal', () => {
    const h = computeChannelHealth(input());
    expect(h.headline).toMatch(/strongest signal/i);
    expect(h.headline).toMatch(/one to watch/i);
  });

  it('handles the no-data case', () => {
    const h = computeChannelHealth(input({ recentViewsPerDay: 0, longFormRetention: null, netSubsPerDay: null, daysSinceLastUpload: null }));
    // reach is still measurable (views 0 → ratio 0 → 20); only satisfaction/growth/publishing null
    expect(dim(h, 'reach').score).toBe(20);
    expect(h.overall).toBe(20);
  });

  it('exposes the default baseline', () => {
    expect(DEFAULT_BASELINE_VPD).toBe(5000);
  });
});
