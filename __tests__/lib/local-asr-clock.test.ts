/**
 * local-asr-clock — regrouping word-level recognition into the short cues the
 * lyric aligner expects. Pure; no ffmpeg, no models.
 */
import {
  wordsToCues,
  mergeShortCues,
  clockCoverage,
  captionShapeProblem,
  type AsrWord,
} from '@/lib/local-asr-clock';

const w = (start: number, end: number, word: string): AsrWord => ({ start, end, word });

describe('wordsToCues', () => {
  it('splits on the silence between sung phrases', () => {
    // Two phrases 1.2s apart — a singer breathing, not a word boundary.
    const cues = wordsToCues([
      w(1.0, 1.4, 'வானவில்லே'),
      w(1.4, 1.9, 'வானவில்லே'),
      w(3.1, 3.6, 'வண்ணச்'),
      w(3.6, 4.0, 'சோலை'),
    ]);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ startMs: 1000, endMs: 1900, text: 'வானவில்லே வானவில்லே' });
    expect(cues[1]).toMatchObject({ startMs: 3100, endMs: 4000, text: 'வண்ணச் சோலை' });
  });

  it('caps a continuous run so one held phrase cannot become a blob', () => {
    // No gap anywhere: only the duration backstop can break this up. Without it
    // the aligner gets one cue where it expects several and every line in the
    // stanza competes for the same anchor.
    const words = Array.from({ length: 20 }, (_, i) => w(i * 0.5, i * 0.5 + 0.5, `சொல்${i}`));
    const cues = wordsToCues(words, { maxCueMs: 4000 });
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) expect(c.endMs - c.startMs).toBeLessThanOrEqual(4000);
  });

  it('keeps cues in order and never overlaps them', () => {
    const cues = wordsToCues([
      w(5.0, 5.4, 'மூன்று'),
      w(0.5, 0.9, 'ஒன்று'),
      w(2.5, 2.9, 'இரண்டு'),
    ]);
    const starts = cues.map((c) => c.startMs);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    for (let i = 1; i < cues.length; i++) expect(cues[i].startMs).toBeGreaterThanOrEqual(cues[i - 1].endMs);
  });

  it('drops words with no text or impossible timings rather than emitting junk cues', () => {
    const cues = wordsToCues([
      w(1.0, 1.5, 'நல்ல'),
      w(2.0, 1.5, 'பின்னோக்கி'), // ends before it starts
      w(3.0, 3.5, '   '), // whitespace only
      w(NaN, 4.0, 'நான்'),
    ]);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('நல்ல');
  });

  it('returns nothing for no input, rather than a zero-length cue', () => {
    expect(wordsToCues([])).toEqual([]);
  });
});

describe('mergeShortCues', () => {
  it('folds a flicker-length fragment into its neighbour, keeping its timing', () => {
    const merged = mergeShortCues(
      [
        { startMs: 0, endMs: 2000, text: 'முதல்' },
        { startMs: 2100, endMs: 2300, text: 'ஓர்' }, // 200ms
      ],
      700
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ startMs: 0, endMs: 2300, text: 'முதல் ஓர்' });
  });

  it('folds a short FIRST cue forwards, since it has no earlier neighbour', () => {
    const merged = mergeShortCues(
      [
        { startMs: 100, endMs: 400, text: 'ஆ' },
        { startMs: 500, endMs: 3000, text: 'வானவில்லே' },
      ],
      700
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ startMs: 100, endMs: 3000, text: 'ஆ வானவில்லே' });
  });

  it('leaves a lone short cue alone rather than deleting the only clock there is', () => {
    const only = [{ startMs: 0, endMs: 200, text: 'ஒன்று' }];
    expect(mergeShortCues(only, 700)).toEqual(only);
  });
});

describe('clockCoverage', () => {
  it('reports the fraction of the track the clock reaches', () => {
    expect(clockCoverage([{ startMs: 0, endMs: 150_000, text: 'x' }], 300)).toBeCloseTo(0.5, 2);
  });

  it('catches the exact failure this module exists to prevent', () => {
    // வானவில்லே's published track: every cue inside the first 3:11 of a 5:41
    // song. A clock that stops early produces captions that drift and then stop.
    const crammed = Array.from({ length: 64 }, (_, i) => ({
      startMs: i * 2800,
      endMs: i * 2800 + 2800,
      text: `cue${i}`,
    }));
    expect(clockCoverage(crammed, 341.2)).toBeLessThan(0.6);
  });

  it('is 0 when there is no clock at all, not NaN', () => {
    expect(clockCoverage([], 300)).toBe(0);
    expect(clockCoverage([{ startMs: 0, endMs: 1000, text: 'x' }], 0)).toBe(0);
  });
});

describe('captionShapeProblem', () => {
  it('catches the whole song in one caption — the real 2026-08-07 failure', () => {
    // A perfect clock and an intact round-trip still produced this: the lyrics
    // file was the stanza-stripped variant, so it read as a single card.
    const oneBlob = [{ startMs: 9180, endMs: 15180, text: Array(128).fill('வரி').join('\n') }];
    expect(captionShapeProblem(oneBlob, 341.2)).toMatch(/ONE caption/);
  });

  it('catches captions that stop before the song does', () => {
    const stopsEarly = Array.from({ length: 20 }, (_, i) => ({
      startMs: i * 2000, endMs: i * 2000 + 2000, text: 'வரி',
    }));
    expect(captionShapeProblem(stopsEarly, 341.2)).toMatch(/stop at/);
  });

  it('catches captions that run PAST the end of the song', () => {
    // Measured 2026-08-07: last cue ended at 390s of a 341s song because
    // interpolation kept extrapolating past the final anchor. Coverage looked
    // healthy (114%), so only an explicit overrun check finds it.
    const overruns = Array.from({ length: 30 }, (_, i) => ({
      startMs: i * 13_000, endMs: i * 13_000 + 6000, text: 'வரி',
    }));
    expect(captionShapeProblem(overruns, 341.2)).toMatch(/run to .* but the song ends/);
  });

  it('tolerates a last cue that overhangs the end by a moment', () => {
    const good = Array.from({ length: 40 }, (_, i) => ({
      startMs: i * 8000, endMs: i * 8000 + 6000, text: 'வரி',
    }));
    // ends at 318s + a 1.2s overhang on a 318s track — normal, not a fault
    expect(captionShapeProblem(good, 317.5)).toBeNull();
  });

  it('catches a caption card too long to read', () => {
    const wall = [
      { startMs: 0, endMs: 4000, text: Array(15).fill('வரி').join('\n') },
      { startMs: 4000, endMs: 300_000, text: 'வரி' },
    ];
    expect(captionShapeProblem(wall, 341.2)).toMatch(/too many to read/);
  });

  it('reports no cues rather than crashing on an empty file', () => {
    expect(captionShapeProblem([], 341.2)).toMatch(/no cues/);
  });

  it('passes a caption file that is actually usable', () => {
    const good = Array.from({ length: 40 }, (_, i) => ({
      startMs: i * 8000, endMs: i * 8000 + 6000, text: 'வானவில்லே\nவண்ணச் சோலை',
    }));
    expect(captionShapeProblem(good, 341.2)).toBeNull();
  });

  it('does not flag a single caption on something genuinely short', () => {
    // A 30s Short legitimately has one card. The rule is about full songs.
    expect(captionShapeProblem([{ startMs: 0, endMs: 25_000, text: 'ஒரு வரி' }], 30)).toBeNull();
  });
});
