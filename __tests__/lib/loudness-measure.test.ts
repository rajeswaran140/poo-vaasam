/** @jest-environment node */
/**
 * loudness-measure — parses real ffmpeg ebur128+astats / loudnorm output.
 * The embedded fixtures are REAL ffmpeg stderr shapes; the live test re-validates
 * end-to-end against ffmpeg when it's on PATH (auto-skips in CI).
 */

import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseMeasurement, badgeAndVerdict, parseLoudnormStats, buildPass2Loudnorm,
} from '@/lib/loudness-measure';

const hasFfmpeg = (() => {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; } catch { return false; }
})();

// Real ebur128 shape: per-frame lines (with I:/LRA:/TPK:) THEN a Summary block.
const STDERR = `
[Parsed_ebur128_0 @ 0x1] t: 0.1  TARGET:-23 LUFS  M:-120.7 S:-120.7  I: -70.0 LUFS  LRA:  0.0 LU  TPK: -3.0 -3.0 dBFS
[Parsed_ebur128_0 @ 0x1] t: 2.0  TARGET:-23 LUFS  M: -9.0 S: -9.0    I:  -9.0 LUFS  LRA:  2.0 LU  TPK: -0.5 -0.5 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:          -9.0 LUFS
    Threshold: -19.0 LUFS

  Loudness range:
    LRA:         3.2 LU

  True peak:
    Peak:       -0.4 dBFS
[Parsed_astats_1 @ 0x2] Peak level dB: -0.400000
[Parsed_astats_1 @ 0x2] RMS level dB: -7.900000
[Parsed_astats_1 @ 0x2] Flat factor: 0.000000
`;

describe('parseMeasurement', () => {
  it('reads the SUMMARY values, not the per-frame spam', () => {
    const r = parseMeasurement(STDERR, -14);
    expect(r.metrics.lufs).toBe(-9.0);      // NOT -70 (the first per-frame I:)
    expect(r.metrics.lra).toBe(3.2);
    expect(r.metrics.truePeak).toBe(-0.4);
    expect(r.metrics.crest).toBe(7.5);      // -0.4 − (-7.9)
    expect(r.metrics.flatFactor).toBe(0);
  });

  it('classifies the hot + clip-risk take (true-peak above -1)', () => {
    const r = parseMeasurement(STDERR, -14);
    expect(r.badge).toBe('+5 LU hot');      // -9 − (-14) = +5
    expect(r.verdict).toBe('clip-risk');    // truePeak -0.4 > -1
  });
});

describe('badgeAndVerdict precedence', () => {
  const base = { lufs: -14, truePeak: -2, flatFactor: 0, crest: 9 };
  it('on-target within ±1 LU', () => {
    expect(badgeAndVerdict({ ...base, lufs: -13.5 }).badge).toBe('on-target (-14)');
    expect(badgeAndVerdict({ ...base, lufs: -13.5 }).verdict).toBe('ok');
  });
  it('hot / quiet badges', () => {
    expect(badgeAndVerdict({ ...base, lufs: -11 }).badge).toBe('+3 LU hot');
    expect(badgeAndVerdict({ ...base, lufs: -18 }).badge).toBe('4 LU quiet');
  });
  it('clip-risk wins over hot/quiet (true-peak or flat factor)', () => {
    expect(badgeAndVerdict({ ...base, lufs: -11, truePeak: -0.5 }).verdict).toBe('clip-risk');
    expect(badgeAndVerdict({ ...base, lufs: -11, flatFactor: 1.2 }).verdict).toBe('clip-risk');
  });
  it('squashed when crest < 6 and not clipping', () => {
    expect(badgeAndVerdict({ ...base, lufs: -14, crest: 4 }).verdict).toBe('squashed');
  });
});

describe('loudnorm pass-1 parsing', () => {
  const json = `[Parsed_loudnorm_0 @ 0x1]
{
\t"input_i" : "-22.05",
\t"input_tp" : "-21.99",
\t"input_lra" : "0.00",
\t"input_thresh" : "-32.05",
\t"target_offset" : "-0.05"
}`;
  it('extracts the measured values', () => {
    const s = parseLoudnormStats(json)!;
    expect(s).toMatchObject({ input_i: -22.05, input_tp: -21.99, input_lra: 0, input_thresh: -32.05, target_offset: -0.05 });
  });
  it('builds a linear pass-2 filter from them', () => {
    const f = buildPass2Loudnorm(parseLoudnormStats(json)!, -14);
    expect(f).toContain('loudnorm=I=-14:TP=-1:LRA=11');
    expect(f).toContain('measured_I=-22.05');
    expect(f).toContain('offset=-0.05');
    expect(f).toContain('linear=true');
  });
  it('returns null on junk', () => {
    expect(parseLoudnormStats('no json here')).toBeNull();
  });
});

(hasFfmpeg ? describe : describe.skip)('live ffmpeg end-to-end', () => {
  function run(filter: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'lm-'));
    try {
      const r = spawnSync('ffmpeg', [
        '-hide_banner', '-nostats', '-f', 'lavfi',
        '-i', 'sine=frequency=1000:duration=4:sample_rate=48000,volume=0.5,aformat=channel_layouts=stereo',
        '-af', filter, '-f', 'null', '-',
      ], { encoding: 'utf8' });
      return `${r.stdout ?? ''}${r.stderr ?? ''}`;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('parses a real measurement pass', () => {
    const r = parseMeasurement(run('ebur128=peak=true,astats=metadata=1:measure_perchannel=0'), -14);
    expect(Number.isFinite(r.metrics.lufs)).toBe(true);
    expect(r.metrics.lufs).toBeLessThan(0);
    expect(Number.isFinite(r.metrics.truePeak)).toBe(true);
    expect(r.metrics.lufs).toBeGreaterThan(-40); // a -6 dBFS tone is nowhere near silence
  });

  it('parses a real loudnorm pass-1 JSON', () => {
    const s = parseLoudnormStats(run('loudnorm=I=-14:TP=-1:LRA=11:print_format=json'));
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!.input_i)).toBe(true);
  });
});
