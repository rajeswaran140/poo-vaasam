/** @jest-environment node */
/**
 * Analysing a source before anything is decided about it.
 *
 * The finding with teeth is the fade check: a SUNO take that already fades out
 * is a RE-ROLL, because a baked-in fade cannot be removed and crossfading into
 * one double-attenuates the seam. So the tests that matter are the ones that
 * keep it honest in both directions — it must not miss a real fade, and it must
 * not cry fade on a song that merely ends softly or ends in silence.
 */
import {
  parseSilences,
  leadingSilenceSec,
  trailingSilenceSec,
  parseTimeline,
  fadeVerdictFromDrop,
  tailDropLu,
  levelVerdict,
  proposedTrim,
  buildSilenceArgs,
  buildTimelineArgs,
  SILENCE_THRESHOLD_DB,
  SILENCE_MIN_SECONDS,
  FADE_DROP_DB,
  LEVEL_MATCH_TOLERANCE_LU,
} from '@/lib/master-analysis';

/**
 * An ebur128 momentary series in ffmpeg's ACTUAL output format, captured from a
 * real run:
 *
 *   [Parsed_ebur128_0 @ 0x55] t: 0.0999792  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU
 *
 * Two details a hand-written fixture gets wrong, and both did: `TARGET:` sits
 * BETWEEN t: and M:, and M has no space after its colon. A parser written
 * against the tidy imagined format matched nothing on real audio and made the
 * tail check permanently "unknown" — invisible, because unknown is a legitimate
 * state. Caught by running real ffmpeg over a real source; keep this format.
 */
/** The retired convenience wrapper, kept here so the tests read unchanged. */
const fadeVerdictFromDrop2 = (pts: Parameters<typeof tailDropLu>[0], trailing = 0, role?: 'lead-in' | 'ending') =>
  fadeVerdictFromDrop(tailDropLu(pts, trailing), role);

const series = (parts: Array<{ secs: number; lufs: number }>): string => {
  const lines: string[] = [];
  let t = 0;
  for (const p of parts) {
    for (let i = 0; i < p.secs * 10; i++) {
      t += 0.1;
      lines.push(
        `[Parsed_ebur128_0 @ 0x55df32723940] t: ${t.toFixed(4)}  TARGET:-23 LUFS    ` +
        `M:${p.lufs.toFixed(1)} S:-23.0     I: -24.0 LUFS       LRA:   5.0 LU`
      );
    }
  }
  return lines.join('\n');
};

describe('silence detection', () => {
  const log = `
[silencedetect @ 0x1] silence_start: 0
[silencedetect @ 0x1] silence_end: 2.34 | silence_duration: 2.34
[silencedetect @ 0x1] silence_start: 120.5
[silencedetect @ 0x1] silence_end: 121.2 | silence_duration: 0.7
[silencedetect @ 0x1] silence_start: 236.1
`;

  it('asks ffmpeg for a floor below a room and above dither', () => {
    const a = buildSilenceArgs('/tmp/in.wav');
    expect(a.join(' ')).toContain(`silencedetect=noise=${SILENCE_THRESHOLD_DB}dB:d=${SILENCE_MIN_SECONDS}`);
    expect(SILENCE_THRESHOLD_DB).toBeLessThanOrEqual(-50);
  });

  it('CLOSES a trailing span that the file ends inside', () => {
    // The most common case there is: dead air at the end of a SUNO export
    // prints silence_start with no silence_end. Dropping it would miss it.
    const spans = parseSilences(log, 240);
    expect(spans).toHaveLength(3);
    expect(spans[2]).toEqual({ startSec: 236.1, endSec: 240 });
  });

  it('reports head and tail dead air, ignoring gaps in the middle', () => {
    const spans = parseSilences(log, 240);
    expect(leadingSilenceSec(spans)).toBe(2.34);
    expect(trailingSilenceSec(spans, 240)).toBe(3.9);
  });

  it('claims no head silence when the first span is not at the start', () => {
    const spans = parseSilences('[silencedetect] silence_start: 12\n[silencedetect] silence_end: 14', 240);
    expect(leadingSilenceSec(spans)).toBe(0);
    expect(trailingSilenceSec(spans, 240)).toBe(0);
  });

  it('survives a log with no silence at all', () => {
    expect(parseSilences('ffmpeg version 6.0\n', 240)).toEqual([]);
    expect(leadingSilenceSec([])).toBe(0);
    expect(trailingSilenceSec([], 240)).toBe(0);
  });

  it('cannot invent a tail span when the duration is unknown', () => {
    expect(parseSilences('[silencedetect] silence_start: 100', 0)).toEqual([]);
    expect(trailingSilenceSec([{ startSec: 1, endSec: 2 }], 0)).toBe(0);
  });
});

describe('the loudness timeline', () => {
  it('reads a momentary reading per line', () => {
    const pts = parseTimeline(series([{ secs: 1, lufs: -20 }]));
    expect(pts).toHaveLength(10);
    expect(pts[0]).toEqual({ tSec: 0.1, momentaryLufs: -20 });
    // The TARGET field between t: and M: is what a naive regex trips on.
    expect(series([{ secs: 0.1, lufs: -20 }])).toContain('TARGET:-23 LUFS');
  });

  it('drops ebur128\'s silence floor rather than averaging it in', () => {
    // -120 and below is "no signal", not a measurement. Leaving it in would
    // drag the tail average down and report a fade on a file that just ends.
    const log = series([{ secs: 1, lufs: -20 }]) +
      '\n[Parsed_ebur128_0 @ 0x55] t: 2.0  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU';
    expect(parseTimeline(log)).toHaveLength(10);
  });

  it('uses one pass for both the shape and the integrated level', () => {
    expect(buildTimelineArgs('/tmp/in.wav').join(' ')).toContain('ebur128');
  });
});

describe('fadeVerdict — the finding that changes what you do', () => {
  const faded = () => parseTimeline(series([
    { secs: 20, lufs: -18 }, { secs: 4, lufs: -18 }, { secs: 1, lufs: -26 },
  ]));

  it('catches a real fade-out on the SEAM side and says to re-roll', () => {
    const v = fadeVerdictFromDrop2(faded(), 0, 'lead-in');
    expect(v.state).toBe('fading');
    expect(v.dropLu).toBe(8);
    expect(v.message).toMatch(/Re-roll/);
    expect(v.message).toMatch(/cannot be removed/);
  });

  /**
   * The scoping that a real run forced. Both parts of வானவில்லே fade at the tail
   * (12.6 LU and 18 LU) — and only Part A's mattered, because Part B's fade IS
   * the end of the song. Warning on an ending would fire on nearly every file
   * and teach the operator to ignore the panel.
   */
  it('does NOT tell you to re-roll a song for ending with a fade', () => {
    const v = fadeVerdictFromDrop2(faded(), 0, 'ending');
    expect(v.state).toBe('fading');
    expect(v.message).toMatch(/normal for a final section/);
    expect(v.message).not.toMatch(/Re-roll/);
  });

  it('defaults to treating a tail as an ending, not a seam', () => {
    // A standalone master is the common case; assuming "seam" would make the
    // alarming wording the default.
    expect(fadeVerdictFromDrop2(faded()).message).not.toMatch(/Re-roll/);
  });

  it('does NOT cry fade on a song that merely ends softly', () => {
    // A 2 LU drift is a sustained note or a reverb tail. Flagging it would send
    // Raj to re-roll a perfectly good take.
    const points = parseTimeline(series([
      { secs: 20, lufs: -18 },
      { secs: 4, lufs: -18 },
      { secs: 1, lufs: -20 },
    ]));
    expect(fadeVerdictFromDrop2(points, 0, 'lead-in').state).toBe('steady');
    expect(fadeVerdictFromDrop2(points, 0, 'lead-in').message).toMatch(/good crossfade material/);
    expect(fadeVerdictFromDrop2(points, 0, 'ending').state).toBe('steady');
  });

  it('sits exactly on the threshold without flapping', () => {
    const at = fadeVerdictFromDrop2(parseTimeline(series([
      { secs: 20, lufs: -18 }, { secs: 4, lufs: -18 }, { secs: 1, lufs: -18 - FADE_DROP_DB },
    ])));
    expect(at.state).toBe('fading');
    const under = fadeVerdictFromDrop2(parseTimeline(series([
      { secs: 20, lufs: -18 }, { secs: 4, lufs: -18 }, { secs: 1, lufs: -18 - FADE_DROP_DB + 0.5 },
    ])));
    expect(under.state).toBe('steady');
  });

  it('ignores trailing SILENCE, which is a trim problem and not a fade', () => {
    // Without this every file ending in dead air reads as fading — and the
    // advice would be "re-roll" when the answer is "trim".
    const points = parseTimeline(series([
      { secs: 20, lufs: -18 },
      { secs: 5, lufs: -18 },
      { secs: 3, lufs: -60 }, // dead air, still above ebur128's floor
    ]));
    expect(fadeVerdictFromDrop2(points, 3).state).toBe('steady');
    // …and with the silence counted as music it would look like a collapse.
    expect(fadeVerdictFromDrop2(points, 0).state).toBe('fading');
  });

  it('says unknown rather than guessing on a clip too short to judge', () => {
    for (const pts of [[], parseTimeline(series([{ secs: 1, lufs: -18 }]))]) {
      const v = fadeVerdictFromDrop2(pts);
      expect(v.state).toBe('unknown');
      expect(v.dropLu).toBeNull();
    }
  });
});

describe('levelVerdict', () => {
  it('passes two parts that arrive at the same level', () => {
    const v = levelVerdict(-14.2, -14.0);
    expect(v.matched).toBe(true);
    expect(v.deltaLu).toBe(0.2);
  });

  it('names which part is louder, and says mastering will NOT fix it', () => {
    const v = levelVerdict(-16.0, -13.0);
    expect(v.matched).toBe(false);
    expect(v.deltaLu).toBe(3);
    expect(v.message).toMatch(/Part B is 3 LU louder/);
    expect(v.message).toMatch(/survives it/);
    expect(levelVerdict(-13.0, -16.0).message).toMatch(/Part A is 3 LU louder/);
  });

  it('treats a difference at the tolerance as matched', () => {
    expect(levelVerdict(-14, -14 - LEVEL_MATCH_TOLERANCE_LU).matched).toBe(true);
    expect(levelVerdict(-14, -14 - LEVEL_MATCH_TOLERANCE_LU - 0.1).matched).toBe(false);
  });

  it('refuses to compare what it could not measure', () => {
    expect(levelVerdict(null, -14).matched).toBe(false);
    expect(levelVerdict(-14, Number.NaN).deltaLu).toBeNull();
  });
});

describe('proposedTrim', () => {
  it('cuts dead air at both ends, leaving a hair so the attack survives', () => {
    expect(proposedTrim({ leadingSilenceSec: 2.34, trailingSilenceSec: 3.9, durationSec: 240 }))
      .toEqual({ trimStartSec: 2.29, trimEndSec: 236.15 });
  });

  it('proposes nothing when there is nothing to cut', () => {
    expect(proposedTrim({ leadingSilenceSec: 0, trailingSilenceSec: 0, durationSec: 240 })).toBeNull();
    // Below the minimum is a gap between phrases, not dead air.
    expect(proposedTrim({ leadingSilenceSec: 0.1, trailingSilenceSec: 0.2, durationSec: 240 })).toBeNull();
  });

  it('handles one end without inventing the other', () => {
    expect(proposedTrim({ leadingSilenceSec: 2, trailingSilenceSec: 0, durationSec: 240 }))
      .toEqual({ trimStartSec: 1.95, trimEndSec: null });
    expect(proposedTrim({ leadingSilenceSec: 0, trailingSilenceSec: 2, durationSec: 240 }))
      .toEqual({ trimStartSec: 0, trimEndSec: 238.05 });
  });

  it('proposes no fade — where a song should fade is a musical decision', () => {
    const p = proposedTrim({ leadingSilenceSec: 2, trailingSilenceSec: 2, durationSec: 240 });
    expect(p).not.toHaveProperty('fadeInSec');
    expect(p).not.toHaveProperty('fadeOutSec');
  });

  it('refuses when the duration is unreadable', () => {
    expect(proposedTrim({ leadingSilenceSec: 2, trailingSilenceSec: 2, durationSec: 0 })).toBeNull();
  });
});
