/** @jest-environment node */
import { FIELD_LIMITS, counterState, textMetrics } from '@/lib/content/authoring';

describe('FIELD_LIMITS', () => {
  it('mirrors the server schema limits', () => {
    expect(FIELD_LIMITS).toEqual({
      title: 200,
      description: 500,
      body: 50_000,
      author: 100,
      seoTitle: 60,
      seoDescription: 160,
    });
  });
});

describe('counterState', () => {
  it('is ok well under the limit', () => {
    expect(counterState(10, 200)).toBe('ok');
  });
  it('warns at >= 90% of the limit', () => {
    expect(counterState(53, 60)).toBe('ok'); // 88%
    expect(counterState(54, 60)).toBe('warn'); // 90%
    expect(counterState(60, 60)).toBe('warn'); // exactly at limit is still allowed
  });
  it('is over only past the limit', () => {
    expect(counterState(61, 60)).toBe('over');
  });
  it('handles a zero limit safely', () => {
    expect(counterState(0, 0)).toBe('ok');
  });
});

describe('textMetrics', () => {
  it('counts zero for empty / whitespace-only text', () => {
    expect(textMetrics('')).toEqual({ chars: 0, words: 0, lines: 0 });
    expect(textMetrics('   \n  ')).toEqual({ chars: 6, words: 0, lines: 2 });
  });
  it('counts Tamil words by whitespace', () => {
    // "தமிழ் கவிதை" → 2 words
    const m = textMetrics('தமிழ் கவிதை');
    expect(m.words).toBe(2);
    expect(m.lines).toBe(1);
    expect(m.chars).toBe('தமிழ் கவிதை'.length);
  });
  it('counts lines including blank ones', () => {
    expect(textMetrics('a\nb\n\nc').lines).toBe(4);
    expect(textMetrics('one line').lines).toBe(1);
  });
  it('collapses runs of whitespace when counting words', () => {
    expect(textMetrics('  one   two\tthree \n four ').words).toBe(4);
  });
});
