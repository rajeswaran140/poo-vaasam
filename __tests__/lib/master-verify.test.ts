/** @jest-environment node */
/**
 * Checking that the render did not touch the audio.
 *
 * The tests that matter here are not the ones proving a good render passes —
 * they are the ones proving each specific way the audio could be altered is
 * actually caught, because every one of those failures produces a file that
 * looks finished and plays fine in a browser. The only evidence would be a
 * listener noticing the song sounds wrong, weeks later, on YouTube.
 *
 * The second thing under test is that "could not measure" never reads as
 * "failed". A check that blocks uploads when ffmpeg declines to report a figure
 * is a check the operator will learn to route around, and then it defends
 * nothing.
 */
import {
  verifyRenderedAudio,
  audioCheckSummary,
  DURATION_TOLERANCE_SEC,
  LUFS_TOLERANCE_LU,
  TRUE_PEAK_RISE_LIMIT_DB,
  LRA_TOLERANCE_LU,
  type AudioSnapshot,
} from '@/lib/master-verify';

/** A real 5:32 master, measured. */
const MASTER: AudioSnapshot = {
  durationSec: 332,
  sampleRate: 48000,
  channels: 2,
  lufs: -14,
  truePeak: -1.5,
  lra: 7.2,
};

/**
 * What a known-good render actually produced, measured 2026-09-22 through the
 * real compose + encode path. Not invented — these are the deltas the
 * tolerances were set from.
 */
const GOOD_RENDER: AudioSnapshot = {
  ...MASTER,
  lufs: -14.1,      // -0.10 LU
  truePeak: -1.6,   // -0.10 dB
};

const out = (over: Partial<AudioSnapshot>): AudioSnapshot => ({ ...GOOD_RENDER, ...over });

describe('a good render passes, and is not near the edge of anything', () => {
  it('accepts the render we actually measured', () => {
    const check = verifyRenderedAudio(MASTER, GOOD_RENDER);
    expect(check.status).toBe('passed');
    expect(check.findings).toEqual([]);
  });

  it('accepts a bit-perfect render', () => {
    expect(verifyRenderedAudio(MASTER, MASTER).status).toBe('passed');
  });

  it('leaves real headroom above the measured deltas', () => {
    // If a tolerance is ever tightened to near the observed difference, every
    // good render starts failing and the check gets ignored. The measured
    // shifts were 0.10; these assert the limits stay well clear.
    expect(LUFS_TOLERANCE_LU).toBeGreaterThanOrEqual(0.5);
    expect(TRUE_PEAK_RISE_LIMIT_DB).toBeGreaterThanOrEqual(0.5);
    expect(DURATION_TOLERANCE_SEC).toBeGreaterThanOrEqual(0.25);
  });

  it('tolerates the true-peak RISE that lossy coding legitimately causes', () => {
    // AAC moves sample values, which can push inter-sample peaks up. Flagging
    // that would fail every correct render.
    expect(verifyRenderedAudio(MASTER, out({ truePeak: -0.8 })).status).toBe('passed');
  });
});

describe('each way the audio could be altered is caught', () => {
  it('catches a resample', () => {
    const check = verifyRenderedAudio(MASTER, out({ sampleRate: 44100 }));
    expect(check.status).toBe('failed');
    expect(check.findings[0].message).toMatch(/48000 Hz.*44100 Hz/);
    expect(check.findings[0].message).toMatch(/resampled/);
  });

  it('catches a channel change — a stereo master arriving as mono', () => {
    const check = verifyRenderedAudio(MASTER, out({ channels: 1 }));
    expect(check.status).toBe('failed');
    expect(check.findings[0].message).toMatch(/remixed/);
  });

  it('catches a truncated song, and says it is CUT OFF rather than "differs"', () => {
    // The likeliest real failure: -shortest ending the video early, or a
    // slideshow whose segments do not add up to the master.
    const check = verifyRenderedAudio(MASTER, out({ durationSec: 310 }));
    expect(check.status).toBe('failed');
    expect(check.findings[0].message).toMatch(/22 s SHORTER/);
    expect(check.findings[0].message).toMatch(/cut off/);
  });

  it('catches a longer video too — the song is not the thing that ended', () => {
    const check = verifyRenderedAudio(MASTER, out({ durationSec: 340 }));
    expect(check.status).toBe('failed');
    expect(check.findings[0].message).toMatch(/8 s longer/);
  });

  it('catches re-levelling in either direction', () => {
    for (const lufs of [-13, -15.5]) {
      const check = verifyRenderedAudio(MASTER, out({ lufs }));
      expect(check.status).toBe('failed');
      expect(check.findings[0].message).toMatch(/re-levelled/);
    }
  });

  it('catches a true peak that rose further than coding explains', () => {
    const check = verifyRenderedAudio(MASTER, out({ truePeak: 0.2 }));
    expect(check.status).toBe('failed');
    expect(check.findings[0].message).toMatch(/clipping/);
  });

  it('catches attenuation, which a rise-only check would miss', () => {
    // ⚠️ The true-peak limit is deliberately asymmetric, and an asymmetric
    // check is easy to write in one direction only. A quieter output is just
    // as much a fault as a louder one.
    const check = verifyRenderedAudio(MASTER, out({ truePeak: -4 }));
    expect(check.status).toBe('failed');
    expect(check.findings[0].message).toMatch(/limited or attenuated/);
  });

  it('catches compression, which loudness alone would not show', () => {
    // A limiter can squeeze the dynamics while leaving integrated loudness
    // almost untouched — so LUFS passes and the song still sounds wrong.
    const check = verifyRenderedAudio(MASTER, out({ lra: 4.1 }));
    expect(check.status).toBe('failed');
    expect(check.findings[0].message).toMatch(/dynamics/);
    expect(LRA_TOLERANCE_LU).toBeLessThanOrEqual(1);
  });

  it('reports every difference, not just the first', () => {
    const check = verifyRenderedAudio(MASTER, out({ sampleRate: 44100, lufs: -11, durationSec: 300 }));
    expect(check.findings.filter((f) => f.violation)).toHaveLength(3);
    expect(check.findings.map((f) => f.field).sort()).toEqual(['duration', 'lufs', 'sampleRate']);
  });
});

describe('"could not measure" is not "failed"', () => {
  it('reports unknown when a figure is missing, and does not call it a violation', () => {
    const check = verifyRenderedAudio(MASTER, out({ lufs: null }));
    expect(check.status).toBe('unknown');
    expect(check.findings).toHaveLength(1);
    expect(check.findings[0].violation).toBe(false);
    expect(check.findings[0].message).toMatch(/Could not compare loudness/);
  });

  it('is unknown when nothing could be measured at all', () => {
    const nothing: AudioSnapshot = {
      durationSec: null, sampleRate: null, channels: null, lufs: null, truePeak: null, lra: null,
    };
    const check = verifyRenderedAudio(MASTER, nothing);
    expect(check.status).toBe('unknown');
    expect(check.findings.every((f) => !f.violation)).toBe(true);
  });

  it('still FAILS when one figure is unreadable and another is definitely wrong', () => {
    // Knowing the sample rate changed is enough. An unreadable LRA does not
    // downgrade that to "we are not sure".
    const check = verifyRenderedAudio(MASTER, out({ lra: null, sampleRate: 44100 }));
    expect(check.status).toBe('failed');
  });

  it('treats a non-finite reading as unmeasurable rather than as zero', () => {
    // ffmpeg prints -inf for silence, and the parser passes that through. A
    // naive comparison would read it as a huge loudness shift and cry wolf.
    for (const bad of [Number.NaN, -Infinity, Infinity]) {
      const check = verifyRenderedAudio(MASTER, out({ lufs: bad }));
      expect(check.status).toBe('unknown');
    }
  });
});

describe('the summary tells the operator what to do', () => {
  it('says not to upload a failed render', () => {
    const check = verifyRenderedAudio(MASTER, out({ durationSec: 300 }));
    expect(audioCheckSummary(check)).toMatch(/Do not upload/);
  });

  it('counts the differences, and gets the singular right', () => {
    expect(audioCheckSummary(verifyRenderedAudio(MASTER, out({ lufs: -11 }))))
      .toMatch(/1 difference\b/);
    expect(audioCheckSummary(verifyRenderedAudio(MASTER, out({ lufs: -11, channels: 1 }))))
      .toMatch(/2 differences/);
  });

  it('does not tell the operator to panic when it simply could not check', () => {
    const summary = audioCheckSummary(verifyRenderedAudio(MASTER, out({ lufs: null })));
    expect(summary).not.toMatch(/Do not upload/);
    expect(summary).toMatch(/could not be fully checked/);
  });
});
