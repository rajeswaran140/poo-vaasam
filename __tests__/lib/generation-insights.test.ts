/**
 * computeInsights — the Music Lab analysis core. Covers empty/small-sample
 * guards, verdict tallies, score/setting contrast, failure ranking,
 * style/engine rates with the reliability gate, the brief-genome rollup, and
 * the recommendation thresholds.
 */

import { computeInsights, MIN_TOTAL, MIN_GROUP } from '@/lib/generation-insights';
import type { Generation } from '@/types/generation';

let seq = 0;
function gen(p: Partial<Generation> = {}): Generation {
  seq += 1;
  return {
    id: `gen_${seq}`,
    briefId: 'b1',
    createdAt: '2026-06-25T00:00:00.000Z',
    updatedAt: '2026-06-25T00:00:00.000Z',
    engine: 'suno',
    settings: {},
    scores: {},
    verdict: 'failed',
    notes: '',
    embedding: null,
    ...p,
  } as Generation;
}
const many = (n: number, p: Partial<Generation>) => Array.from({ length: n }, () => gen(p));

describe('computeInsights', () => {
  it('handles an empty log without dividing by zero', () => {
    const r = computeInsights([]);
    expect(r.total).toBe(0);
    expect(r.successRate).toBeNull();
    expect(r.byVerdict).toEqual({ success: 0, partial: 0, failed: 0 });
    expect(r.hasEnoughData).toBe(false);
    expect(r.recommendations[0]).toMatch(/no generations logged/i);
  });

  it('tallies verdicts and success rate', () => {
    const r = computeInsights([
      ...many(3, { verdict: 'success' }),
      ...many(1, { verdict: 'partial' }),
      ...many(6, { verdict: 'failed' }),
    ]);
    expect(r.total).toBe(10);
    expect(r.byVerdict).toEqual({ success: 3, partial: 1, failed: 6 });
    expect(r.successRate).toBeCloseTo(0.3);
    expect(r.hasEnoughData).toBe(true);
  });

  it('refuses to surface patterns below MIN_TOTAL', () => {
    const r = computeInsights(many(MIN_TOTAL - 1, { verdict: 'success' }));
    expect(r.hasEnoughData).toBe(false);
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0]).toMatch(new RegExp(`at least ${MIN_TOTAL}`));
  });

  it('contrasts scores between keepers and rejects and finds the separating axis', () => {
    const r = computeInsights([
      ...many(5, { verdict: 'success', scores: { melody: 9, vocals: 5 } }),
      ...many(5, { verdict: 'failed', scores: { melody: 4, vocals: 5 } }),
    ]);
    expect(r.scoreContrast.melody).toMatchObject({ success: 9, failed: 4, gap: 5 });
    expect(r.scoreContrast.vocals.gap).toBe(0);
    // melody (gap 5) is the differentiator → called out positively
    expect(r.recommendations.some((s) => /melody/i.test(s) && /differentiator/i.test(s))).toBe(true);
  });

  it('ranks failure reasons by frequency (successes never contribute a reason)', () => {
    const r = computeInsights([
      ...many(4, { verdict: 'failed', failureReason: 'vocal_delivery' }),
      ...many(2, { verdict: 'failed', failureReason: 'mixing' }),
      ...many(4, { verdict: 'success' }),
    ]);
    expect(r.failureReasons).toEqual([
      { reason: 'vocal_delivery', count: 4 },
      { reason: 'mixing', count: 2 },
    ]);
    expect(r.recommendations.some((s) => /vocal delivery/i.test(s))).toBe(true);
  });

  it('rates styles, flags only sufficiently-sampled buckets as reliable, best-first', () => {
    const r = computeInsights([
      ...many(MIN_GROUP + 1, { chosenStyle: 'Devotional', verdict: 'success' }), // 5
      ...many(2, { chosenStyle: 'Folk', verdict: 'success' }), // 3 total → under MIN_GROUP
      ...many(1, { chosenStyle: 'Folk', verdict: 'failed' }),
    ]); // 8 total → clears MIN_TOTAL
    const dev = r.byStyle.find((s) => s.key === 'Devotional')!;
    const folk = r.byStyle.find((s) => s.key === 'Folk')!;
    expect(dev).toMatchObject({ total: MIN_GROUP + 1, success: MIN_GROUP + 1, rate: 1, reliable: true });
    expect(folk.reliable).toBe(false);
    expect(r.byStyle[0].key).toBe('Devotional'); // best rate first
    // recommendation only cites the reliable one
    expect(r.recommendations.some((s) => /Devotional/.test(s))).toBe(true);
    expect(r.recommendations.some((s) => /"Folk"/.test(s))).toBe(false);
  });

  it('contrasts settings and warns when weirdness tracks failure', () => {
    const r = computeInsights([
      ...many(5, { verdict: 'success', settings: { weirdness: 10 } }),
      ...many(5, { verdict: 'failed', settings: { weirdness: 70 } }),
    ]);
    expect(r.settingsContrast.weirdness).toMatchObject({ success: 10, failed: 70, gap: -60 });
    expect(r.recommendations.some((s) => /weirdness/i.test(s) && /down/i.test(s))).toBe(true);
  });

  it('rolls the brief genome (emotion/raga/voice) onto generations', () => {
    const briefs = {
      b1: { analysis: { emotion: 'காதல்', suggested_ragas: ['Keeravani'], recommended_voice: ['Male Baritone'] } as never },
    };
    const r = computeInsights(
      [...many(MIN_GROUP, { briefId: 'b1', verdict: 'success' }), gen({ briefId: 'b1', verdict: 'failed' })],
      briefs
    );
    const raga = r.genome.find((x) => x.dimension === 'raga' && x.value === 'Keeravani')!;
    expect(raga.total).toBe(MIN_GROUP + 1);
    expect(raga.success).toBe(MIN_GROUP);
    expect(raga.reliable).toBe(true);
    expect(r.genome.some((x) => x.dimension === 'emotion' && x.value === 'காதல்')).toBe(true);
  });

  it('ignores genome when the brief is unknown (no crash)', () => {
    const r = computeInsights(many(MIN_TOTAL, { briefId: 'missing', verdict: 'success' }), {});
    expect(r.genome).toEqual([]);
    expect(r.hasEnoughData).toBe(true);
  });
});
