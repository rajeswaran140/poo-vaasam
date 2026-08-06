/**
 * Calibration — the rules checked against measured ground truth, not against
 * other tests.
 *
 * WHY THIS FILE EXISTS. Everything else in the suite asserts that a function
 * returns what the author believed it should return. That catches regressions
 * and cannot catch a shared misconception, which is the failure mode that
 * actually bit this module three times in one week — a parser that matched
 * nothing on real ffmpeg output, a fade verdict that over-warned on every song
 * ending in a fade, and an LRA blocker that rejected half of a shipped song.
 *
 * These assertions run against test/fixtures/audio/golden.json, whose numbers
 * come from ffmpeg measuring synthetic audio whose correct answer is derivable
 * from ITU-R BS.1770. No ffmpeg here — CI has none, and the WAVs are ~35 MB.
 * Regenerate with:
 *
 *     bash scripts/make-fixtures.sh
 *     npx tsx scripts/verify-fixtures.ts test/fixtures/audio --write
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { predictedLinearOutputPeak, screenTake, TRUE_PEAK_CEILING_DBTP } from '@/lib/take-screen';

interface Measured {
  integratedLufs: number | null;
  lra: number | null;
  truePeakDbtp: number | null;
  samplePeakDbfs: number | null;
  normalizationType: 'linear' | 'dynamic' | null;
}
interface Golden {
  ffmpegVersions: string[];
  fixtures: Record<string, {
    source: 'arithmetic' | 'frozen';
    derived?: Partial<Measured>;
    tolerance: { integratedLu?: number; lraLu?: number; truePeakDb?: number };
    measured?: Measured;
  }>;
}

const golden: Golden = JSON.parse(
  readFileSync(join(process.cwd(), 'test/fixtures/audio/golden.json'), 'utf8'),
);
const fx = (name: string) => {
  const f = golden.fixtures[name];
  if (!f?.measured) throw new Error(`golden.json has no measurement for ${name}`);
  return f;
};

describe('the corpus itself', () => {
  it('records which ffmpeg produced the frozen numbers', () => {
    // Production runs 7.0.2 in the Lambda layer; local dev is whatever the box
    // has. The numbers below were confirmed identical on 4.4.2 and 7.0.2, but
    // that is a fact to re-establish rather than assume, so the versions that
    // have agreed are recorded.
    expect(golden.ffmpegVersions.length).toBeGreaterThan(0);
  });

  it('keeps derived and frozen expectations distinguishable', () => {
    for (const [name, spec] of Object.entries(golden.fixtures)) {
      expect(['arithmetic', 'frozen']).toContain(spec.source);
      expect(spec.measured).toBeDefined();
      expect(name).toMatch(/\.wav$/);
    }
  });
});

describe('gain path — measured against BS.1770 arithmetic', () => {
  it('a stereo 1 kHz sine reads an integrated loudness equal to its peak dBFS', () => {
    // K-weighting at 1 kHz is +0.6977 dB and the standard's offset is -0.691 dB;
    // they cancel to 0.007 dB. Nothing is left but the channel summation, so
    // this is the anchor that would expose any stray gain in the chain.
    const m = fx('tone_1k_stereo_minus20.wav').measured!;
    expect(m.integratedLufs).toBeCloseTo(-20, 1);
    expect(m.truePeakDbtp).toBeCloseTo(-20, 1);
  });

  it('the same tone in mono reads exactly 3.01 LU quieter off an identical peak', () => {
    // The control. If the stereo anchor were right by coincidence rather than
    // by summation, this would not hold.
    const stereo = fx('tone_1k_stereo_minus20.wav').measured!;
    const mono = fx('tone_1k_mono_minus20.wav').measured!;
    expect(mono.truePeakDbtp).toBeCloseTo(stereo.truePeakDbtp!, 1);
    expect(stereo.integratedLufs! - mono.integratedLufs!).toBeCloseTo(3.01, 1);
  });
});

describe('forces-dynamic — the predictor against what loudnorm actually did', () => {
  // This is the assertion the module went without for months. The rule refuses
  // a take because it predicts ffmpeg will compress it; until there was a file
  // that provably makes ffmpeg compress, the prediction was only ever checked
  // against a hand-written number.

  it('predicts compression on the take ffmpeg actually compressed', () => {
    const m = fx('pink_ladder_forces_dynamic.wav').measured!;
    expect(m.normalizationType).toBe('dynamic');

    const predicted = predictedLinearOutputPeak(m.integratedLufs!, m.truePeakDbtp!, -14);
    expect(predicted).toBeGreaterThan(TRUE_PEAK_CEILING_DBTP);

    const result = screenTake(
      { file: 'ladder', integratedLufs: m.integratedLufs, truePeakDbtp: m.truePeakDbtp, lra: m.lra },
      { targetLufs: -14 },
    );
    expect(result.verdict).toBe('reject');
    expect(result.findings.map((f) => f.code)).toContain('forces-dynamic');
  });

  it('does not predict compression on the take ffmpeg normalised linearly', () => {
    const m = fx('pink_gentle_linear.wav').measured!;
    expect(m.normalizationType).toBe('linear');

    const predicted = predictedLinearOutputPeak(m.integratedLufs!, m.truePeakDbtp!, -14);
    expect(predicted).toBeLessThanOrEqual(TRUE_PEAK_CEILING_DBTP);

    const result = screenTake(
      { file: 'gentle', integratedLufs: m.integratedLufs, truePeakDbtp: m.truePeakDbtp, lra: m.lra },
      { targetLufs: -14 },
    );
    expect(result.findings.map((f) => f.code)).not.toContain('forces-dynamic');
  });

  it('the wide-LRA fixture really is wide — the relative gate did not eat it', () => {
    // A -26 dB quiet section measures LRA 6.3, not ~26, because LRA gates at
    // -20 LU below the ungated mean. Every step of this ladder sits inside the
    // gate, which is the only reason the fixture exercises anything.
    expect(fx('pink_ladder_forces_dynamic.wav').measured!.lra).toBeGreaterThan(15);
  });
});

describe('true peak', () => {
  it('exceeds sample peak by about 3 dB on the intersample trap', () => {
    // A tone at fs/4 offset 45 degrees puts every sample on 0.7071 x A while
    // the reconstructed waveform peaks at A. The STRUCTURAL claim is what is
    // asserted: ffmpeg reads this roughly +0.5 dB high against both the
    // arithmetic and an independent 64x resampler, so the exact figure is an
    // implementation detail that an ffmpeg upgrade may move. The gap is not.
    const m = fx('isp_trap_fs4.wav').measured!;
    expect(m.samplePeakDbfs).toBeCloseTo(-3.01, 1);
    expect(m.truePeakDbtp! - m.samplePeakDbfs!).toBeGreaterThan(2.5);
  });

  it('sample peak and true peak agree on a signal with no overshoot', () => {
    const m = fx('tone_1k_stereo_minus20.wav').measured!;
    expect(Math.abs(m.truePeakDbtp! - m.samplePeakDbfs!)).toBeLessThan(0.1);
  });
});

describe('the LRA=0.00 trap', () => {
  it('flat fixtures report dynamic, so they can never corroborate linear mode', () => {
    // ffmpeg reads measured_LRA=0.00 as "not supplied" and silently abandons
    // linear mode. Confirmed identical on 4.4.2 and 7.0.2: 0.00 -> dynamic,
    // 0.01 -> linear. A "flat reference must normalise linearly" fixture is
    // therefore unsatisfiable, and would read as a broken chain forever.
    for (const name of ['tone_1k_stereo_minus20.wav', 'tone_1k_mono_minus20.wav']) {
      const m = fx(name).measured!;
      expect(m.lra).toBe(0);
      expect(m.normalizationType).toBe('dynamic');
    }
    // And the fixture that DOES prove linear mode deliberately is not flat.
    expect(fx('pink_gentle_linear.wav').measured!.lra).toBeGreaterThan(0);
  });
});
