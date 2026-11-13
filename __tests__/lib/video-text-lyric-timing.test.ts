import { applyTimedLines, linesAndVerses, lyricTimingKeys, timeLyricLines, type LyricTimingWords } from '@/lib/video-text/lyric-timing';
import type { TextBlock } from '@/types/videoText';

/** Words sung at the given times; the text is what the recogniser "heard". */
const sung = (items: Array<[number, number, string]>) => items.map(([start, end, word]) => ({ start, end, word }));
/** Vocal loudness: -20 dB inside `on`, -70 dB elsewhere, every 0.1 s. */
const loud = (seconds: number, on: Array<[number, number]>) => ({
  hopSec: 0.1,
  db: Array.from({ length: seconds * 10 }, (_, i) => (on.some(([a, b]) => i / 10 >= a && i / 10 < b) ? -20 : -70)),
});

describe('linesAndVerses', () => {
  it('keeps one caption per non-empty line and marks verse openings after blank lines', () => {
    const { lines, verseStarts } = linesAndVerses('  one \ntwo\n\n\nthree\nfour\n');
    expect(lines).toEqual(['one', 'two', 'three', 'four']);
    expect([...verseStarts]).toEqual([0, 2]);
  });
});

describe('timeLyricLines', () => {
  const lyrics = 'பூவும் காற்றும்\nமகனே வாசம்\n\nதமிழும் இசையும்\nஉயிரே பாசம்';
  const sensor: LyricTimingWords = {
    durationSec: 60,
    words: sung([
      [10, 11, 'பூவும்'], [11, 12, 'காற்றும்'],
      [14, 15, 'மகனே'], [15, 16, 'வாசம்'],
      [40, 41, 'தமிழும்'], [41, 42, 'இசையும்'],
      [44, 45, 'உயிரே'], [45, 46, 'பாசம்'],
    ]),
    activity: loud(60, [[10, 17], [40, 47]]),
  };

  it('times every line with Raj\'s own text, in order, inside the video', () => {
    const r = timeLyricLines(lyrics, sensor);
    if (!r.ok) throw new Error(r.error);
    expect(r.lines.map((l) => l.text)).toEqual(['பூவும் காற்றும்', 'மகனே வாசம்', 'தமிழும் இசையும்', 'உயிரே பாசம்']);
    expect(r.lines[0].startSec).toBeCloseTo(10, 0);
    expect(r.lines[2].startSec).toBeCloseTo(40, 0);
    for (let i = 0; i < r.lines.length; i++) {
      const l = r.lines[i];
      expect(l.endSec - l.startSec).toBeGreaterThanOrEqual(0.5);
      expect(l.endSec).toBeLessThanOrEqual(60);
      if (i > 0) expect(l.startSec).toBeGreaterThanOrEqual(r.lines[i - 1].endSec);
    }
    // No caption sits through the 17-40 s music break.
    expect(r.lines[1].endSec).toBeLessThanOrEqual(18.5);
  });

  it('refuses without lyrics or without any heard singing', () => {
    expect(timeLyricLines('  \n ', sensor)).toEqual({ ok: false, error: expect.stringMatching(/Paste the lyrics/) });
    expect(timeLyricLines(lyrics, { ...sensor, words: [] })).toEqual({ ok: false, error: expect.stringMatching(/No singing was heard/) });
  });

  it('still works without the loudness data (older words files)', () => {
    const r = timeLyricLines(lyrics, { durationSec: 60, words: sensor.words });
    expect(r.ok).toBe(true);
  });
});

describe('applyTimedLines', () => {
  it('replaces the lyric track, keeps title and credits, and reuses ids for unchanged lines', () => {
    const blocks: TextBlock[] = [
      { id: 't', track: 'title', text: 'Title', startSec: 0, endSec: 5 },
      { id: 'a', track: 'lyric', text: 'one', startSec: 5, endSec: 6 },
      { id: 'b', track: 'lyric', text: 'old two', startSec: 6, endSec: 7 },
    ];
    let n = 0;
    const out = applyTimedLines(blocks, [
      { text: 'one', startSec: 10, endSec: 12, heard: true },
      { text: 'two', startSec: 12, endSec: 14, heard: false },
    ], () => `new${n++}`);
    expect(out).toEqual([
      { id: 't', track: 'title', text: 'Title', startSec: 0, endSec: 5 },
      { id: 'a', track: 'lyric', text: 'one', startSec: 10, endSec: 12 },
      { id: 'new0', track: 'lyric', text: 'two', startSec: 12, endSec: 14 },
    ]);
  });
});

describe('lyricTimingKeys', () => {
  it('puts all three files under the worker\'s writable prefix, per source video', () => {
    const k = lyricTimingKeys('p1', 'audio/mastering/video-text/p1/source/1794_ab12_My_song.mp4');
    expect(k).toEqual({
      words: 'audio/mastering/lyric-timing/p1/1794_ab12_My_song.words.json',
      error: 'audio/mastering/lyric-timing/p1/1794_ab12_My_song.error.json',
      started: 'audio/mastering/lyric-timing/p1/1794_ab12_My_song.started.json',
    });
  });
});
