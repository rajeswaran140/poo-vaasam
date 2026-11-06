/** @jest-environment node */
/**
 * A story's Style: one line written once, added to every picture and clip
 * request and given to the storyboard draft, so the look does not drift from
 * shot to shot. Empty means no style line at all — never "Visual style:" with
 * nothing after it.
 */
import { withStyle, styleSchema, MAX_STYLE_CHARS } from '@/lib/visual-story-style';

describe('withStyle', () => {
  it('adds the style after the shot\'s own prompt', () => {
    expect(withStyle('A lamp on a sill', '  warm cinematic film, 35mm ')).toBe('A lamp on a sill\n\nVisual style: warm cinematic film, 35mm');
  });
  it('leaves the prompt alone with no style', () => {
    expect(withStyle('A lamp on a sill', '')).toBe('A lamp on a sill');
    expect(withStyle('A lamp on a sill', '   ')).toBe('A lamp on a sill');
    expect(withStyle('A lamp on a sill', undefined)).toBe('A lamp on a sill');
  });
});

describe('styleSchema', () => {
  it('trims, allows empty, and caps the length', () => {
    expect(styleSchema.parse('  golden hour  ')).toBe('golden hour');
    expect(styleSchema.parse('')).toBe('');
    expect(styleSchema.safeParse('x'.repeat(MAX_STYLE_CHARS + 1)).success).toBe(false);
    expect(MAX_STYLE_CHARS).toBe(300);
  });
});
