/**
 * Aligning authored lyrics to a YouTube ASR track's real timings — gives a clean
 * lyric caption accurate timing (incl. inter-stanza gaps) with no hand-syncing.
 */

import { alignLyricsToAsr, alignLyricLineStarts, fillStarts } from '@/lib/align-lyrics';
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

  it('strips [annotation] markers and drops marker-only cues', () => {
    const srt =
      '1\n00:00:02,000 --> 00:00:05,000\n[இசை]\n\n' + // music-only → dropped
      '2\n00:00:29,000 --> 00:00:31,000\nஎன் பாட்டு [இசை][பாடுதல்]'; // inline markers stripped
    expect(parseSrt(srt)).toEqual([{ start: 29, end: 31, text: 'என் பாட்டு' }]);
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

describe('alignLyricLineStarts (phrase/word-level)', () => {
  it('starts each line at its first word time, threading the word stream', () => {
    const asr = [
      { start: 0, end: 5, text: 'alpha beta' },
      { start: 5, end: 10, text: 'gamma delta' },
      { start: 12, end: 17, text: 'epsilon zeta' },
    ];
    expect(alignLyricLineStarts(['alpha beta gamma delta', 'epsilon zeta'], asr)).toEqual([0, 12]);
  });

  it('times a line whose words sit mid-cue (boundary straddle)', () => {
    // ASR words: alpha@0, beta@3, gamma@6, delta@9
    const asr = [
      { start: 0, end: 6, text: 'alpha beta' },
      { start: 6, end: 12, text: 'gamma delta' },
    ];
    // line 2 ("beta gamma") should start at beta's real time (3), not cue start.
    expect(alignLyricLineStarts(['alpha', 'beta gamma', 'delta'], asr)).toEqual([0, 3, 9]);
  });

  it('leaves a line undefined when none of its words match', () => {
    const asr = [{ start: 0, end: 5, text: 'alpha beta' }];
    expect(alignLyricLineStarts(['zzzz yyyy'], asr)).toEqual([undefined]);
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
