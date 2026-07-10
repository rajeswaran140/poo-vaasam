/** @jest-environment node */
/**
 * Tests for the shared composer brief schema — the single source of truth used
 * by both the composer service (tool input_schema + validation) and the briefs
 * route (durable-record validation).
 */

import {
  composerAnalysisSchema,
  composerAnalysisJsonSchema,
} from '@/services/ai/composerSchema';

const VALID = {
  emotion: 'காதல்',
  emotion_breakdown: ['காதல்', 'ஏக்கம்'],
  mood: 'Tender',
  theme: 'Longing',
  suggested_key: 'D Minor',
  suggested_bpm: 72,
  suggested_instruments: ['Veena', 'Flute'],
  suggested_ragas: ['Mohanam', 'Kalyani'],
  recommended_voice: ['Female Adult'],
  song_titles: ['இரவின் அன்பு'],
  suno_prompts: [{ style: 'Devotional', prompt: 'A gentle devotional piece.' }],
  thumbnail_prompt: 'A moonlit Tamil courtyard.',
  youtube_description_tamil: 'விளக்கம். #tamilagaval',
  youtube_description_english: 'Description. #tamilagaval',
  reel: { hook: 'நிலவே', caption: 'A love song', hashtags: ['#tamil'] },
};

it('accepts a complete brief', () => {
  expect(composerAnalysisSchema.safeParse(VALID).success).toBe(true);
});

it('derives a JSON Schema object suitable for a Claude tool input_schema', () => {
  expect(composerAnalysisJsonSchema).toMatchObject({ type: 'object' });
  const props = (composerAnalysisJsonSchema as { properties: Record<string, unknown> }).properties;
  expect(Object.keys(props)).toEqual(
    expect.arrayContaining(['emotion', 'suno_prompts', 'youtube_description_english', 'reel'])
  );
});

it('keeps the computed musical_consistency field OUT of the model tool schema', () => {
  const schema = composerAnalysisJsonSchema as { properties: Record<string, unknown>; required?: string[] };
  // Computed post-hoc by the raga/scale guard — the model must never produce it.
  expect(schema.properties).not.toHaveProperty('musical_consistency');
  expect(schema.required ?? []).not.toContain('musical_consistency');
});

it('clamps an out-of-range bpm to the 90 fallback', () => {
  const r = composerAnalysisSchema.safeParse({ ...VALID, suggested_bpm: 5000 });
  expect(r.success).toBe(true);
  if (r.success) expect(r.data.suggested_bpm).toBe(90);
});

it('coerces a non-integer bpm via the same fallback', () => {
  const r = composerAnalysisSchema.safeParse({ ...VALID, suggested_bpm: 'fast' });
  expect(r.success).toBe(true);
  if (r.success) expect(r.data.suggested_bpm).toBe(90);
});

it('fills a missing reel with a well-formed empty idea', () => {
  const { reel: _drop, ...noReel } = VALID;
  const r = composerAnalysisSchema.safeParse(noReel);
  expect(r.success).toBe(true);
  if (r.success) expect(r.data.reel).toEqual({ hook: '', caption: '', hashtags: [] });
});

it('rejects a missing required semantic field (no silent default)', () => {
  const { theme: _drop, ...noTheme } = VALID;
  expect(composerAnalysisSchema.safeParse(noTheme).success).toBe(false);
});

it('requires suggested_ragas (the brief must recommend ragas)', () => {
  const { suggested_ragas: _drop, ...noRagas } = VALID;
  expect(composerAnalysisSchema.safeParse(noRagas).success).toBe(false);
});

it('rejects empty required arrays', () => {
  expect(composerAnalysisSchema.safeParse({ ...VALID, suno_prompts: [] }).success).toBe(false);
  expect(composerAnalysisSchema.safeParse({ ...VALID, emotion_breakdown: [] }).success).toBe(false);
});

it('strips unknown keys rather than persisting them', () => {
  const r = composerAnalysisSchema.safeParse({ ...VALID, sneaky: 'x' });
  expect(r.success).toBe(true);
  if (r.success) expect(r.data as Record<string, unknown>).not.toHaveProperty('sneaky');
});
