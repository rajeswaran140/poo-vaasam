/** @jest-environment node */
/**
 * audio-metrics — exact peak/RMS/crest/clip invariants, LUFS gating/monotonicity,
 * and a cross-check of the BS.1770 LUFS against the reference `ffmpeg ebur128`
 * (auto-skipped where ffmpeg isn't on PATH, e.g. CI, so it never blocks deploys).
 */

import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeAudioMetrics, computeLufsIntegrated } from '@/lib/audio-metrics';

const SR = 48000;

function sine(freq: number, durSec: number, amp: number): Float32Array {
  const n = Math.round(durSec * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

const hasFfmpeg = (() => {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; } catch { return false; }
})();

describe('computeAudioMetrics — exact metrics', () => {
  it('measures peak, RMS, crest and clipping on a half-scale sine', () => {
    const m = computeAudioMetrics([sine(1000, 1, 0.5)], SR);
    expect(m.peakDbfs).toBeCloseTo(-6.0, 1);           // 0.5 → −6 dBFS
    expect(m.rmsDbfs).toBeCloseTo(-9.0, 0);            // sine RMS = peak − 3.01 dB
    expect(m.crestDb).toBeCloseTo(3.0, 0);             // sine crest ≈ 3 dB
    expect(m.clipPct).toBe(0);
    expect(m.durationSec).toBe(1);
  });

  it('flags clipping on a full-scale signal', () => {
    const full = new Float32Array(48000).fill(1.0);
    const m = computeAudioMetrics([full], SR);
    expect(m.peakDbfs).toBeCloseTo(0, 1);
    expect(m.clipPct).toBeGreaterThan(99); // essentially all samples at full scale
  });
});

describe('computeLufsIntegrated — gating & invariants', () => {
  it('returns null for silence (below the absolute gate)', () => {
    expect(computeLufsIntegrated([new Float32Array(SR * 2)], SR)).toBeNull();
  });

  it('returns null below one 400 ms block, or at a non-48k rate', () => {
    expect(computeLufsIntegrated([sine(1000, 0.2, 0.5)], SR)).toBeNull(); // 200 ms < 400 ms
    expect(computeLufsIntegrated([sine(1000, 2, 0.5)], 44100)).toBeNull(); // wrong rate → no guess
  });

  it('is monotonic: doubling amplitude raises loudness by ~6 LU', () => {
    const quiet = computeLufsIntegrated([sine(1000, 3, 0.25)], SR)!;
    const loud = computeLufsIntegrated([sine(1000, 3, 0.5)], SR)!;
    expect(loud - quiet).toBeCloseTo(6.0, 0);
  });
});

(hasFfmpeg ? describe : describe.skip)('LUFS cross-check vs ffmpeg ebur128', () => {
  function writeWavMono(samples: Float32Array, path: string) {
    const n = samples.length;
    const buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
    buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
    }
    writeFileSync(path, buf);
  }

  it('matches ffmpeg within ±1 LU on a 1 kHz tone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lufs-'));
    try {
      const samples = sine(1000, 5, 0.5);
      const wav = join(dir, 'tone.wav');
      writeWavMono(samples, wav);

      // ebur128 prints its summary to stderr; spawnSync exposes it directly.
      const res = spawnSync('ffmpeg', ['-nostats', '-i', wav, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
      const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
      const m = out.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g);
      const ffmpegLufs = m ? parseFloat(m[m.length - 1].match(/(-?\d+(?:\.\d+)?)/)![1]) : NaN;
      const mine = computeLufsIntegrated([samples], SR)!;

      expect(Number.isFinite(ffmpegLufs)).toBe(true);
      expect(Math.abs(mine - ffmpegLufs)).toBeLessThanOrEqual(1.0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
