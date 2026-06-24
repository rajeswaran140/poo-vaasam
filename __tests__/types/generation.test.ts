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
    }
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
