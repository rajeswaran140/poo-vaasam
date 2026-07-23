/**
 * computeInsights — the Music Lab analysis core. Covers empty/small-sample
 * guards, verdict tallies, score/setting contrast, failure ranking,
 * style/engine rates with the reliability gate, the brief-genome rollup, and
 * the recommendation thresholds.
 */

import { computeInsights, MIN_TOTAL, MIN_GROUP, normalizeEngineModel } from '@/lib/generation-insights';
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

  it('rates voice + model, flagging only sufficiently-sampled buckets, and cites the reliable ones', () => {
    const r = computeInsights([
      ...many(MIN_GROUP + 1, { verdict: 'success', settings: { voiceLabel: 'Anitha', customModel: 'devotional-pathos' } }), // 5, reliable
      ...many(2, { verdict: 'failed', settings: { voiceLabel: 'Guest' } }), // 2, under MIN_GROUP
      ...many(1, { verdict: 'failed' }),
    ]); // 8 total → clears MIN_TOTAL
    const anitha = r.byVoice.find((s) => s.key === 'Anitha')!;
    const guest = r.byVoice.find((s) => s.key === 'Guest')!;
    expect(anitha).toMatchObject({ total: MIN_GROUP + 1, success: MIN_GROUP + 1, rate: 1, reliable: true });
    expect(guest.reliable).toBe(false);
    const model = r.byModel.find((s) => s.key === 'devotional-pathos')!;
    expect(model).toMatchObject({ total: MIN_GROUP + 1, reliable: true });
    // recommendations cite the reliable voice + model, not the under-sampled Guest
    expect(r.recommendations.some((s) => /Voice "Anitha" lands 100%/.test(s))).toBe(true);
    expect(r.recommendations.some((s) => /Model "devotional-pathos" lands 100%/.test(s))).toBe(true);
    expect(r.recommendations.some((s) => /"Guest"/.test(s))).toBe(false);
  });

  it('skips takes with no voiceLabel/customModel from the voice/model breakdowns', () => {
    const r = computeInsights(many(MIN_TOTAL, { verdict: 'success' }));
    expect(r.byVoice).toEqual([]);
    expect(r.byModel).toEqual([]);
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

  it('contrasts measured audio (keepers vs rejects) and recommends on it', () => {
    const metrics = (lufs: number, crest: number) => ({ durationSec: 60, peakDbfs: -1, rmsDbfs: -1 - crest, crestDb: crest, clipPct: 0, lufsIntegrated: lufs });
    const r = computeInsights([
      ...many(6, { verdict: 'success', audioMetrics: metrics(-11, 10) }), // keepers: dynamic
      ...many(4, { verdict: 'failed', audioMetrics: metrics(-7, 4) }),    // rejects: hot + squashed
    ]);
    expect(r.audioContrast.crest.success).toBe(10);
    expect(r.audioContrast.crest.failed).toBe(4);
    expect(r.audioContrast.crest.gap).toBe(6);
    expect(r.audioContrast.lufs.success).toBe(-11);
    expect(r.recommendations.join(' ')).toMatch(/breathe more|crest/i);
    expect(r.recommendations.join(' ')).toMatch(/LUFS/);
  });

  it('leaves audioContrast null when no take has measurements', () => {
    const r = computeInsights(many(MIN_TOTAL, { verdict: 'success' }));
    expect(r.audioContrast.lufs.success).toBeNull();
    expect(r.audioContrast.crest.gap).toBeNull();
  });
});

// Added 2026-07-22 after Suno confirmed a model-side regression. The version tag
// is typed by hand, so unless it's folded into one bucket the sample splits and
// "did quality drop after the update?" becomes unanswerable.
describe('normalizeEngineModel', () => {
  it('folds hand-typed spellings of the same release into one bucket', () => {
    const variants = ['suno v5.5', 'Suno 5.5', 'SUNO  v5.5 ', 'suno-5.5'];
    const normalized = new Set(variants.map((v) => normalizeEngineModel(v)));
    expect(normalized.size).toBe(1);
    expect([...normalized][0]).toBe('suno v5.5');
  });

  it('keeps genuinely different versions apart', () => {
    expect(normalizeEngineModel('suno v5')).not.toBe(normalizeEngineModel('suno v5.5'));
  });

  it('returns undefined for a blank tag rather than inventing a version', () => {
    expect(normalizeEngineModel(undefined)).toBeUndefined();
    expect(normalizeEngineModel('')).toBeUndefined();
    expect(normalizeEngineModel('   ')).toBeUndefined();
  });

  it('falls back to the plain tag when there is no version number', () => {
    expect(normalizeEngineModel('  Udio  Beta ')).toBe('udio beta');
  });
});

describe('byEngineVersion', () => {
  const gen = (engineModel: string, verdict: 'success' | 'failed') =>
    ({
      id: `g${Math.random()}`, briefId: 'b1', engine: 'suno', verdict,
      settings: { engineModel }, scores: {}, stemRevisions: [], notes: '',
      audioMetrics: null, loudness: null, embedding: null,
      createdAt: '2026-07-01', updatedAt: '2026-07-01',
    }) as unknown as Parameters<typeof computeInsights>[0][number];

  it('separates a good release from a regressed one across spelling variants', () => {
    const gens = [
      ...Array.from({ length: 4 }, () => gen('suno v5', 'success')),
      // same release, three different hand-typed spellings — must still pool
      gen('suno v5.5', 'failed'), gen('Suno 5.5', 'failed'),
      gen('SUNO v5.5', 'failed'), gen('suno-5.5', 'success'),
    ];
    const r = computeInsights(gens);
    const v5 = r.byEngineVersion.find((b) => b.key === 'suno v5');
    const v55 = r.byEngineVersion.find((b) => b.key === 'suno v5.5');

    expect(v5).toMatchObject({ total: 4, success: 4, reliable: true });
    expect(v55).toMatchObject({ total: 4, success: 1, reliable: true });
    expect(v55!.rate).toBeLessThan(v5!.rate); // the regression is visible
  });

  it('ignores attempts with no version tag', () => {
    const r = computeInsights([gen('', 'success'), gen('suno v5', 'success')]);
    expect(r.byEngineVersion).toHaveLength(1);
    expect(r.byEngineVersion[0].key).toBe('suno v5');
  });
});
