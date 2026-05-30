/** @jest-environment node */
/**
 * Unit tests for src/lib/youtube-match.ts — the fuzzy YouTube↔site matcher
 * used by the /admin/youtube dashboard's "not yet on the site" callout.
 */

import { normalizeTitle, videoMatchesContent } from '@/lib/youtube-match';

describe('normalizeTitle', () => {
  it('lowercases + trims + collapses whitespace', () => {
    expect(normalizeTitle('  Hello   World  ')).toBe('hello world');
  });

  it('strips the dotted-ellipsis filler YouTube titles use', () => {
    expect(normalizeTitle('அந்தி மேகமே. . . எங்கே சாய்கின்றாய். . .'))
      .toBe('அந்தி மேகமே எங்கே சாய்கின்றாய்');
  });

  it('drops the "| TamilAgaval" suffix', () => {
    expect(normalizeTitle('அந்தி மேகமே | TamilAgaval'))
      .toBe('அந்தி மேகமே');
    expect(normalizeTitle('Some Song | Tamil Agaval Music'))
      .toBe('some song');
  });

  it('drops common "(Official … Video)" decorations', () => {
    expect(normalizeTitle('Anthi Megame (Official Lyric Video)'))
      .toBe('anthi megame');
    expect(normalizeTitle('Anthi Megame [Tamil Lyrics Video]'))
      .toBe('anthi megame');
    expect(normalizeTitle('Anthi Megame - Official'))
      .toBe('anthi megame');
  });

  it('NFC-normalises so canonically equivalent sequences compare equal', () => {
    // Latin é has two unicode forms: precomposed U+00E9, or e + combining
    // acute (U+0065 U+0301). NFC collapses both to the same byte sequence.
    const composed = 'é';        // é (precomposed)
    const decomposed = 'é';     // e + ́
    expect(normalizeTitle(composed)).toBe(normalizeTitle(decomposed));
  });

  it('returns empty for empty / nullish input', () => {
    expect(normalizeTitle('')).toBe('');
    expect(normalizeTitle(undefined as unknown as string)).toBe('');
  });
});

describe('videoMatchesContent', () => {
  const v = (title: string, id = 'vid1') => ({ id, title });

  it('matches when youtubeVideoId equals the video id (preferred, exact)', () => {
    expect(
      videoMatchesContent(v('totally different title', 'gfywsN483lI'), {
        title: 'whatever',
        youtubeVideoId: 'gfywsN483lI',
      })
    ).toBe(true);
  });

  it('matches when the videoUrl contains the YouTube ID (definitive)', () => {
    expect(
      videoMatchesContent(v('totally different title', 'gfywsN483lI'), {
        title: 'whatever',
        videoUrl: 'https://www.youtube.com/watch?v=gfywsN483lI',
      })
    ).toBe(true);
  });

  it('youtubeVideoId mismatch does not block fallback paths from matching', () => {
    // Explicit ID is wrong, but the videoUrl carries the right one — should still match.
    expect(
      videoMatchesContent(v('whatever', 'gfywsN483lI'), {
        title: 'whatever',
        youtubeVideoId: 'WRONGIDWRON',
        videoUrl: 'https://www.youtube.com/watch?v=gfywsN483lI',
      })
    ).toBe(true);
  });

  it('matches when YouTube has the descriptive tail and DB has the short title', () => {
    expect(
      videoMatchesContent(
        v('அந்தி மேகமே. . . எங்கே சாய்கின்றாய். . .'),
        { title: 'அந்தி மேகமே' }
      )
    ).toBe(true);
  });

  it('matches when DB title has extra "| Tamilagaval" or punctuation', () => {
    expect(
      videoMatchesContent(v('Anthi Megame'), { title: 'Anthi Megame | TamilAgaval' })
    ).toBe(true);
    expect(
      videoMatchesContent(v('Anthi Megame (Official Lyric Video)'), { title: 'Anthi Megame' })
    ).toBe(true);
  });

  it('returns true on exact normalised equality', () => {
    expect(
      videoMatchesContent(v('  Anthi   Megame  '), { title: 'Anthi Megame' })
    ).toBe(true);
  });

  it('refuses short substrings that would over-match', () => {
    // "a" is 1 char — must not match every title that contains "a".
    expect(
      videoMatchesContent(v('a'), { title: 'அம்மா poem' })
    ).toBe(false);
  });

  it('returns false when there is no overlap and no videoUrl', () => {
    expect(
      videoMatchesContent(v('Completely different upload'), { title: 'அம்மா' })
    ).toBe(false);
  });

  it('returns false on missing/empty content fields', () => {
    expect(videoMatchesContent(v('anything'), { title: '', videoUrl: '' })).toBe(false);
    expect(videoMatchesContent(v('anything'), {})).toBe(false);
  });

  it('ignores videoUrl when it does not contain the ID', () => {
    expect(
      videoMatchesContent(v('Anthi Megame', 'gfywsN483lI'), {
        title: 'Anthi Megame',
        videoUrl: 'https://www.youtube.com/watch?v=DIFFERENTID', // still matches by title
      })
    ).toBe(true);
    expect(
      videoMatchesContent(v('Totally different', 'gfywsN483lI'), {
        title: 'Some other song',
        videoUrl: 'https://www.youtube.com/watch?v=DIFFERENTID', // neither matches
      })
    ).toBe(false);
  });
});
