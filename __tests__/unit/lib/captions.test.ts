/**
 * Caption generation from structured lyrics — SRT/WebVTT cues, the unblocked
 * core of the captions component (manual upload + karaoke today, captions.insert
 * once a write token is wired).
 */

import { lyricsToCues, toSRT, toWebVTT, formatTimestamp } from '@/lib/captions';
import { Lyrics } from '@/domain/songs/Lyrics';

describe('formatTimestamp', () => {
  it('formats SRT (comma) and WebVTT (dot) timestamps', () => {
    expect(formatTimestamp(0, ',')).toBe('00:00:00,000');
    expect(formatTimestamp(5.25, ',')).toBe('00:00:05,250');
    expect(formatTimestamp(3661.5, '.')).toBe('01:01:01.500');
  });

  it('clamps negatives to zero', () => {
    expect(formatTimestamp(-2, '.')).toBe('00:00:00.000');
  });
});

describe('lyricsToCues', () => {
  it('returns [] for empty lyrics or non-positive total', () => {
    expect(lyricsToCues(Lyrics.empty(), { totalSec: 100 })).toEqual([]);
    expect(lyricsToCues(Lyrics.fromPlainText('a\nb'), { totalSec: 0 })).toEqual([]);
  });

  it('distributes lines evenly when there are no timestamps', () => {
    const cues = lyricsToCues(Lyrics.fromPlainText('a\nb\nc\nd'), { totalSec: 40 });
    expect(cues).toEqual([
      { start: 0, end: 10, text: 'a' },
      { start: 10, end: 20, text: 'b' },
      { start: 20, end: 30, text: 'c' },
      { start: 30, end: 40, text: 'd' },
    ]);
  });

  it('uses per-line timestamps when synced (cue runs to the next start)', () => {
    const lyrics = Lyrics.fromObject({
      sections: [
        {
          kind: 'pallavi',
          lines: [
            { text: 'first', startSeconds: 5 },
            { text: 'second', startSeconds: 12 },
          ],
        },
      ],
    });
    const cues = lyricsToCues(lyrics, { totalSec: 30 });
    expect(cues).toEqual([
      { start: 5, end: 12, text: 'first' },
      { start: 12, end: 30, text: 'second' },
    ]);
  });

  it('caps cues at the track end', () => {
    const lyrics = Lyrics.fromObject({
      sections: [{ kind: 'other', lines: [{ text: 'late', startSeconds: 95 }] }],
    });
    const cues = lyricsToCues(lyrics, { totalSec: 100, minCueSec: 1 });
    expect(cues[0].start).toBe(95);
    expect(cues[0].end).toBe(100);
  });
});

describe('toSRT / toWebVTT', () => {
  const cues = [
    { start: 0, end: 5, text: 'வரி ஒன்று' },
    { start: 5, end: 10, text: 'வரி இரண்டு' },
  ];

  it('serialises SRT with 1-based indices and comma timestamps', () => {
    expect(toSRT(cues)).toBe(
      '1\n00:00:00,000 --> 00:00:05,000\nவரி ஒன்று\n\n' +
        '2\n00:00:05,000 --> 00:00:10,000\nவரி இரண்டு'
    );
  });

  it('serialises WebVTT with the header and dot timestamps', () => {
    expect(toWebVTT(cues)).toBe(
      'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nவரி ஒன்று\n\n' +
        '00:00:05.000 --> 00:00:10.000\nவரி இரண்டு'
    );
  });

  it('WebVTT still emits a valid header for no cues', () => {
    expect(toWebVTT([])).toBe('WEBVTT\n');
  });

  it('end-to-end: lyrics → cues → SRT', () => {
    const srt = toSRT(lyricsToCues(Lyrics.fromPlainText('one\ntwo'), { totalSec: 20 }));
    expect(srt).toContain('00:00:00,000 --> 00:00:10,000');
    expect(srt).toContain('one');
  });
});
