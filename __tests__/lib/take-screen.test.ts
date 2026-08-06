/** @jest-environment node */
/**
 * Screening takes before a human listens.
 *
 * The screen exists to remove takes that CANNOT work — ~55 are listened to per
 * released song, about 440 decisions a month. So the tests pull in two
 * directions at once: it must catch the genuinely unusable, and it must never
 * reject something merely unusual. A screen that discards good work is worse
 * than no screen, because the discarding is invisible.
 */
import {
  screenTake,
  summariseScreen,
  predictedLinearOutputPeak,
  LOW_LRA_NOTE,
  TRUE_PEAK_CEILING_DBTP,
  EXPECTED_LUFS_RANGE,
} from '@/lib/take-screen';

/** A healthy SUNO render, using the real catalogue's numbers. */
const good = (over: Record<string, unknown> = {}) => ({
  file: 'take.wav',
  durationSec: 251,
  integratedLufs: -14.3,
  truePeakDbtp: -3.5,
  lra: 3.0,
  leadingSilenceSec: 0,
  trailingSilenceSec: 0,
  tailDropLu: 0.4,
  ...over,
});

describe('predictedLinearOutputPeak — the physics the screen rests on', () => {
  it('is the input peak plus the gain needed to reach target', () => {
    // A linear gain moves every sample equally, so the peak moves with it.
    expect(predictedLinearOutputPeak(-14.3, -3.5, -14)).toBeCloseTo(-3.2, 2);
    expect(predictedLinearOutputPeak(-20, -2, -14)).toBeCloseTo(4, 2);
  });

  it('predicts the case that actually bites: a hot, quiet take', () => {
    // -0.5 dBTP at -18 LUFS needs +4 dB to reach -14 → +3.5 dBTP. Way over.
    expect(predictedLinearOutputPeak(-18, -0.5, -14)).toBeCloseTo(3.5, 2);
  });
});

describe('what the screen REJECTS', () => {
  it('rejects a take whose master would be forced to compress', () => {
    // The strongest rule: derived from the module's own dynamics proof, and
    // knowable before a single pass of mastering is spent.
    const r = screenTake(good({ integratedLufs: -18, truePeakDbtp: -0.5 }));
    expect(r.verdict).toBe('reject');
    expect(r.findings[0].code).toBe('forces-dynamic');
    expect(r.findings[0].detail).toMatch(/dynamic mode and COMPRESS/);
    expect(r.findings[0].detail).toMatch(/Re-roll/);
  });



  it('rejects a broken render by its level', () => {
    for (const lufs of [EXPECTED_LUFS_RANGE[0] - 1, EXPECTED_LUFS_RANGE[1] + 1]) {
      expect(screenTake(good({ lufs, integratedLufs: lufs, truePeakDbtp: -20 })).verdict).toBe('reject');
    }
  });

  it('rejects a truncated take when the intended length is known', () => {
    const r = screenTake(good({ durationSec: 90 }), { expectedDurationSec: 251 });
    expect(r.verdict).toBe('reject');
    expect(r.findings.some((f) => f.code === 'duration-outlier')).toBe(true);
    // …and says which way it went wrong.
    expect(r.findings.find((f) => f.code === 'duration-outlier')!.detail).toMatch(/truncated/);
  });

  it('rejects a baked-in fade ONLY when the take must lead into a seam', () => {
    const faded = good({ tailDropLu: 12.6 }); // வானவில்லே Part A, measured
    expect(screenTake(faded, { role: 'lead-in' }).verdict).toBe('reject');
    // The same file is a perfectly good standalone song.
    const asSong = screenTake(faded, { role: 'song' });
    expect(asSong.verdict).toBe('shortlist');
    expect(asSong.findings.some((f) => f.code === 'ends-with-fade')).toBe(true);
  });
});

describe('what the screen must NOT reject', () => {
  it('shortlists a healthy take with no findings at all', () => {
    const r = screenTake(good());
    expect(r.verdict).toBe('shortlist');
    expect(r.findings).toHaveLength(0);
  });

  /**
   * The regression that a real run caught. As a BLOCKER this rule rejected
   * வானவில்லே Part B (LRA 1.6) — half of a song that shipped — because the
   * 2.3-5.0 floor came from finished full-length songs and was applied to a
   * raw section. Part A 2.5 + Part B 1.6 assembled to 2.2.
   */
  it('NEVER rejects a flat take — measured sections legitimately run low', () => {
    for (const lra of [1.6, 2.2, 2.5, 2.6, 3.4, 5.0]) {
      expect(screenTake(good({ lra })).verdict).toBe('shortlist');
    }
  });

  it('still SAYS a take is flat, as a note rather than a refusal', () => {
    const r = screenTake(good({ lra: 1.6 }));
    expect(r.findings.find((f) => f.code === 'low-range')?.severity).toBe('note');
    expect(r.findings.find((f) => f.code === 'low-range')?.detail).toMatch(/shipped/);
    expect(LOW_LRA_NOTE).toBe(2.2);
  });

  it('treats dead air as fixable, not fatal — that is what the trim is for', () => {
    const r = screenTake(good({ leadingSilenceSec: 3.2, trailingSilenceSec: 4.1 }));
    expect(r.verdict).toBe('shortlist');
    expect(r.findings.every((f) => f.severity === 'fixable')).toBe(true);
    expect(r.findings).toHaveLength(2);
  });

  it('does not reject on a peak alone — only on what mastering would DO with it', () => {
    // A hot peak on an already-loud take needs a NEGATIVE gain, so the master
    // still lands under the ceiling. Rejecting on peak alone would discard it.
    const r = screenTake(good({ integratedLufs: -10, truePeakDbtp: -0.5 }));
    expect(predictedLinearOutputPeak(-10, -0.5, -14)).toBeLessThan(TRUE_PEAK_CEILING_DBTP);
    expect(r.verdict).toBe('shortlist');
  });

  it('never rejects for a measurement it does not have', () => {
    // An unmeasured field is not a failure. Treating unknown as bad is how a
    // screen quietly discards good work.
    const r = screenTake({ file: 'x.wav', durationSec: 240 });
    expect(r.verdict).toBe('shortlist');
    expect(r.findings).toHaveLength(0);
  });

  it('reports `unmeasured` rather than judging a file ffmpeg could not read', () => {
    const r = screenTake({ file: 'broken.wav' });
    expect(r.verdict).toBe('unmeasured');
    expect(r.findings).toHaveLength(0);
  });

  it('accepts a duration inside tolerance', () => {
    expect(screenTake(good({ durationSec: 240 }), { expectedDurationSec: 251 }).verdict).toBe('shortlist');
  });
});

describe('summariseScreen — the screen must show its own value', () => {
  it('counts what was removed from the listening pile, and why', () => {
    const results = [
      screenTake(good()),
      screenTake(good({ durationSec: 40 }), { expectedDurationSec: 251 }),
      screenTake(good({ integratedLufs: -18, truePeakDbtp: -0.5 })),
      screenTake(good({ integratedLufs: -25, truePeakDbtp: -20 })),
      screenTake({ file: 'unreadable.wav' }),
    ];
    const s = summariseScreen(results);
    expect(s).toMatchObject({ total: 5, shortlisted: 1, rejected: 3, unmeasured: 1, savedFromListening: 3 });
    expect(s.byCode['duration-outlier']).toBe(1);
    expect(s.byCode['forces-dynamic']).toBe(1);
    expect(s.byCode['level-outlier']).toBe(1);
  });

  it('an empty run summarises to zeroes rather than throwing', () => {
    expect(summariseScreen([])).toMatchObject({ total: 0, rejected: 0, savedFromListening: 0 });
  });
});
