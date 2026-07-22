/**
 * createGenerationSchema — the Music Lab generation contract. Proves defaults,
 * score bounds, the empty-audioUrl coercion, and the success⇏failureReason rule.
 */

import { createGenerationSchema } from '@/types/generation';

const base = { briefId: 'brief_1', verdict: 'failed' as const };

describe('createGenerationSchema', () => {
  it('accepts a minimal payload and applies defaults', () => {
    const r = createGenerationSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.engine).toBe('suno'); // default engine
      expect(r.data.settings).toEqual({}); // default settings
      expect(r.data.scores).toEqual({}); // default scores
      expect(r.data.notes).toBe(''); // default notes
      expect(r.data.audioUrl).toBeUndefined();
      expect(r.data.audioMetrics).toBeNull(); // absent → null
    }
  });

  it('accepts measured audioMetrics', () => {
    const r = createGenerationSchema.safeParse({
      ...base,
      audioMetrics: { durationSec: 60, peakDbfs: -1.2, rmsDbfs: -12.3, crestDb: 11.1, clipPct: 0, lufsIntegrated: -10.4 },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.audioMetrics?.lufsIntegrated).toBe(-10.4);
  });

  it('allows a null lufsIntegrated (below-gate audio) but rejects a bad clipPct', () => {
    expect(createGenerationSchema.safeParse({
      ...base, audioMetrics: { durationSec: 1, peakDbfs: -3, rmsDbfs: -9, crestDb: 6, clipPct: 0, lufsIntegrated: null },
    }).success).toBe(true);
    expect(createGenerationSchema.safeParse({
      ...base, audioMetrics: { durationSec: 1, peakDbfs: -3, rmsDbfs: -9, crestDb: 6, clipPct: 150, lufsIntegrated: null },
    }).success).toBe(false);
  });

  it('requires a briefId', () => {
    const r = createGenerationSchema.safeParse({ verdict: 'success' });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown verdict', () => {
    expect(createGenerationSchema.safeParse({ ...base, verdict: 'meh' }).success).toBe(false);
  });

  it('coerces an empty-string audioUrl to undefined (rate before the MP3 is back)', () => {
    const r = createGenerationSchema.safeParse({ ...base, audioUrl: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.audioUrl).toBeUndefined();
  });

  it('rejects a non-URL audioUrl', () => {
    expect(createGenerationSchema.safeParse({ ...base, audioUrl: 'not a url' }).success).toBe(false);
  });

  it('accepts an http(s) audioUrl', () => {
    expect(createGenerationSchema.safeParse({ ...base, audioUrl: 'https://cdn.example.com/a.mp3' }).success).toBe(true);
    expect(createGenerationSchema.safeParse({ ...base, audioUrl: 'http://cdn.example.com/a.mp3' }).success).toBe(true);
  });

  it('rejects a non-http(s) audioUrl scheme', () => {
    expect(createGenerationSchema.safeParse({ ...base, audioUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(createGenerationSchema.safeParse({ ...base, audioUrl: 'ftp://h/a.mp3' }).success).toBe(false);
    expect(createGenerationSchema.safeParse({ ...base, audioUrl: 'data:audio/mp3;base64,AAAA' }).success).toBe(false);
  });

  it('enforces 0–10 integer score bounds', () => {
    expect(createGenerationSchema.safeParse({ ...base, scores: { melody: 8 } }).success).toBe(true);
    expect(createGenerationSchema.safeParse({ ...base, scores: { melody: 11 } }).success).toBe(false);
    expect(createGenerationSchema.safeParse({ ...base, scores: { melody: 7.5 } }).success).toBe(false);
    expect(createGenerationSchema.safeParse({ ...base, scores: { vocals: -1 } }).success).toBe(false);
  });

  it('clamps settings knobs to 0–100', () => {
    expect(createGenerationSchema.safeParse({ ...base, settings: { weirdness: 50, styleInfluence: 0 } }).success).toBe(true);
    expect(createGenerationSchema.safeParse({ ...base, settings: { weirdness: 101 } }).success).toBe(false);
  });

  it('accepts a voiceLabel and customModel in settings (trimmed)', () => {
    const r = createGenerationSchema.safeParse({
      ...base,
      settings: { voiceLabel: '  Anitha  ', customModel: '  devotional-pathos  ' },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.settings.voiceLabel).toBe('Anitha');
      expect(r.data.settings.customModel).toBe('devotional-pathos');
    }
  });

  it('rejects an over-long voiceLabel / customModel', () => {
    expect(createGenerationSchema.safeParse({ ...base, settings: { voiceLabel: 'x'.repeat(121) } }).success).toBe(false);
    expect(createGenerationSchema.safeParse({ ...base, settings: { customModel: 'x'.repeat(121) } }).success).toBe(false);
  });

  it('defaults stemRevisions to an empty array', () => {
    const r = createGenerationSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.stemRevisions).toEqual([]);
  });

  it('accepts a list of stem revisions', () => {
    const r = createGenerationSchema.safeParse({ ...base, stemRevisions: ['re-sang lead', 'swapped flute for veena'] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.stemRevisions).toEqual(['re-sang lead', 'swapped flute for veena']);
  });

  it('rejects empty-string or over-long stem revisions and caps the list at 24', () => {
    expect(createGenerationSchema.safeParse({ ...base, stemRevisions: [''] }).success).toBe(false);
    expect(createGenerationSchema.safeParse({ ...base, stemRevisions: ['x'.repeat(201)] }).success).toBe(false);
    expect(createGenerationSchema.safeParse({ ...base, stemRevisions: Array.from({ length: 25 }, (_, i) => `r${i}`) }).success).toBe(false);
    expect(createGenerationSchema.safeParse({ ...base, stemRevisions: Array.from({ length: 24 }, (_, i) => `r${i}`) }).success).toBe(true);
  });

  it('allows a failureReason on a failed/partial verdict', () => {
    expect(createGenerationSchema.safeParse({ ...base, failureReason: 'vocal_delivery' }).success).toBe(true);
    expect(createGenerationSchema.safeParse({ briefId: 'b', verdict: 'partial', failureReason: 'mixing' }).success).toBe(true);
  });

  it('REJECTS a failureReason on a success (keeps the dataset coherent)', () => {
    const r = createGenerationSchema.safeParse({ briefId: 'b', verdict: 'success', failureReason: 'mixing' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toContain('failureReason');
  });

  it('rejects an unknown failureReason', () => {
    expect(createGenerationSchema.safeParse({ ...base, failureReason: 'autotune' }).success).toBe(false);
  });
});

// promptText added 2026-07-22: chosenStyle records only WHICH variant was
// picked, so a hand-edited prompt — exactly what you do when hunting for
// wording that still lands post-regression — left the attempt unreproducible.
describe('promptText', () => {
  const base = { briefId: 'b1', verdict: 'success' as const };

  it('accepts and trims the prompt actually submitted', () => {
    const r = createGenerationSchema.safeParse({ ...base, promptText: '  Carnatic ballad, 78 BPM.  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.promptText).toBe('Carnatic ballad, 78 BPM.');
  });

  it('stays optional so pre-existing rows remain valid', () => {
    const r = createGenerationSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.promptText).toBeUndefined();
  });

  it('rejects an absurdly long prompt', () => {
    expect(createGenerationSchema.safeParse({ ...base, promptText: 'x'.repeat(4001) }).success).toBe(false);
  });
});
