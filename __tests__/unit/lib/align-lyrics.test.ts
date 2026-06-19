/**
 * Aligning authored lyrics to a YouTube ASR track's real timings — gives a clean
 * lyric caption accurate timing (incl. inter-stanza gaps) with no hand-syncing.
 */

import { alignLyricsToAsr, fillStarts } from '@/lib/align-lyrics';
import { parseSrt } from '@/lib/captions';

describe('parseSrt', () => {
  it('parses SRT blocks into timed cues (comma ms)', () => {
    const srt = '1\n00:00:25,279 --> 00:00:29,560\nஎழுதாத வரியிலே\n\n2\n00:00:30,560 --> 00:00:34,840\nஎன்ன பெயர் வந்ததோ';
    expect(parseSrt(srt)).toEqual([
      { start: 25.279, end: 29.56, text: 'எழுதாத வரியிலே' },
      { start: 30.56, end: 34.84, text: 'என்ன பெயர் வந்ததோ' },
    ]);
  });

  it('tolerates dot ms + CRLF and skips junk', () => {
    const srt = '1\r\n00:01:00.000 --> 00:01:02.500\r\nline\r\n\r\ngarbage';
    expect(parseSrt(srt)).toEqual([{ start: 60, end: 62.5, text: 'line' }]);
  });
});

describe('alignLyricsToAsr', () => {
  // ASR splits each lyric line into two half-line cues (as real YouTube ASR does).
  const asr = [
    { start: 25.3, end: 29, text: 'எழுதாத வரியிலே' },
    { start: 30.5, end: 34, text: 'என்ன பெயர் வந்ததோ' },
    { start: 35.6, end: 39, text: 'படிக்காத விழியிலே' },
    { start: 40.8, end: 45, text: 'புது உலகம் தோன்றுதோ' },
  ];

  it('adopts the start of the ASR cue that opens each lyric line', () => {
    const lines = ['எழுதாத வரியிலே என்ன பெயர் வந்ததோ', 'படிக்காத விழியிலே புது உலகம் தோன்றுதோ'];
    expect(alignLyricsToAsr(lines, asr)).toEqual([25.3, 35.6]);
  });

  it('matches repeated lines to successive occurrences (monotonic)', () => {
    const asr2 = [
      { start: 10, end: 12, text: 'காதல்' },
      { start: 40, end: 42, text: 'காதல்' },
    ];
    expect(alignLyricsToAsr(['காதல்', 'காதல்'], asr2)).toEqual([10, 40]);
  });

  it('leaves a line undefined when no match is in the window', () => {
    expect(alignLyricsToAsr(['totally different words'], asr)).toEqual([undefined]);
  });

  it('interpolates within a cue that straddles a line boundary', () => {
    // One ASR cue holds the end of line A + the start of line B ("gamma").
    const straddle = [
      { start: 0, end: 6, text: 'alpha beta' },
      { start: 6, end: 12, text: 'delta gamma epsilon' }, // gamma at index 1 of 3
    ];
    const [a, b] = alignLyricsToAsr(['alpha beta', 'gamma stuff'], straddle);
    expect(a).toBe(0);
    expect(b).toBeCloseTo(8, 5); // 6 + (1/3)*6
  });
});

describe('fillStarts', () => {
  it('interpolates undefined starts between anchors and keeps anchors exact', () => {
    expect(fillStarts([10, undefined, 40], 100)).toEqual([10, 25, 40]);
  });

  it('extends a leading/trailing gap toward startSec / totalSec', () => {
    const out = fillStarts([undefined, 50, undefined], 100, 0);
    expect(out[1]).toBe(50);
    expect(out[0]).toBeLessThan(50);
    expect(out[2]).toBeGreaterThan(50);
  });

  it('falls back to even distribution with no anchors', () => {
    expect(fillStarts([undefined, undefined], 100, 0)).toEqual([0, 50]);
  });

  it('forces monotonic non-decreasing output', () => {
    const out = fillStarts([30, 20, 10], 100);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
  });
});
