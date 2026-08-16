/** @jest-environment node */
/**
 * Lyrics must survive validation.
 *
 * ⚠️ Zod STRIPS unknown keys by default. When `lyrics` was missing from these
 * schemas the admin form posted it, the API returned 200, and the field was
 * discarded before it ever reached the entity — a save that reports success and
 * stores nothing. That is the same silent-drop shape that hid 37 songs, so it
 * gets a test rather than a comment.
 */

import { createContentSchema, updateContentSchema } from '@/lib/validations/content';

const LYRICS = {
  sections: [
    { kind: 'pallavi' as const, lines: [{ text: 'நீ சிரிச்ச நேரம் தான்' }, { text: 'நேரம் நின்னு போச்சு' }] },
  ],
};

describe('lyrics survive the update schema', () => {
  it('keeps the lyrics object instead of stripping it', () => {
    const r = updateContentSchema.safeParse({ id: 'cnt_1', lyrics: LYRICS });
    expect(r.success).toBe(true);
    // The assertion that matters: PRESENT, not merely valid.
    expect(r.success && r.data.lyrics).toEqual(LYRICS);
  });

  it('accepts null to clear lyrics', () => {
    const r = updateContentSchema.safeParse({ id: 'cnt_1', lyrics: null });
    expect(r.success).toBe(true);
    expect(r.success && r.data.lyrics).toBeNull();
  });

  it('leaves lyrics untouched when the key is absent', () => {
    const r = updateContentSchema.safeParse({ id: 'cnt_1', title: 'x' });
    expect(r.success).toBe(true);
    expect(r.success && 'lyrics' in r.data).toBe(false);
  });

  it('carries optional per-line romanisation and timings through', () => {
    const timed = {
      sections: [
        {
          kind: 'pallavi' as const,
          label: 'பல்லவி',
          lines: [{ text: 'நீ சிரிச்ச', romanized: 'nee sirichcha', startSeconds: 12.5 }],
        },
      ],
    };
    const r = updateContentSchema.safeParse({ id: 'cnt_1', lyrics: timed });
    expect(r.success && r.data.lyrics).toEqual(timed);
  });

  it('rejects a bad section kind rather than silently dropping it', () => {
    const r = updateContentSchema.safeParse({
      id: 'cnt_1',
      lyrics: { sections: [{ kind: 'chorus-ish', lines: [] }] },
    });
    expect(r.success).toBe(false);
  });
});

describe('lyrics survive the create schema', () => {
  it('keeps lyrics on create', () => {
    const r = createContentSchema.safeParse({
      type: 'SONGS',
      title: 'ஒரு பாடல்',
      body: 'உடல்',
      description: 'விளக்கம்',
      author: 'இராஜ்',
      lyrics: LYRICS,
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.lyrics).toEqual(LYRICS);
  });
});
