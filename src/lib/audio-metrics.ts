/**
 * Objective sound-engineering metrics for a logged Music Lab take — measured,
 * not opinion. Pure functions over decoded PCM (Float32 channels), so they're
 * deterministic and unit-tested; the browser glue (Web Audio decode → 48 kHz
 * render) feeds them. No LLM, no paid service.
 *
 * `lufsIntegrated` implements EBU R128 / ITU-R BS.1770-4 (K-weighting + 400 ms
 * blocks at 75% overlap + −70 LUFS absolute and −10 LU relative gating). The
 * K-weighting coefficients are the canonical 48 kHz set, so PCM MUST be 48 kHz
 * (the caller resamples); at other rates LUFS returns null rather than lie.
 * Validated against `ffmpeg ebur128` in the test suite.
 */

export interface AudioMetrics {
  durationSec: number;
  /** Sample peak in dBFS (0 = full scale). */
  peakDbfs: number;
  /** RMS level in dBFS. */
  rmsDbfs: number;
  /** Crest factor = peak − RMS (dB). Higher = more dynamic; low = squashed. */
  crestDb: number;
  /** Percent of samples at/above −0.1 dBFS (≈ clipping). */
  clipPct: number;
  /** Integrated loudness (LUFS), or null when below gate / too short / non-48k. */
  lufsIntegrated: number | null;
}

const R128_RATE = 48000;
const ABS_GATE_LUFS = -70;
const REL_GATE_LU = -10;

// K-weighting (BS.1770-4, 48 kHz). Stage 1: high-shelf; stage 2: RLB high-pass.
const STAGE1 = { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 };
const STAGE2 = { b0: 1.0, b1: -2.0, b2: 1.0, a1: -1.99004745483398, a2: 0.99007225036621 };

const lin = (db: number) => Math.pow(10, db / 20);
const CLIP_THRESHOLD = lin(-0.1);

/** Direct-form-I biquad over a channel (a0 normalised to 1). */
function biquad(x: Float32Array, c: { b0: number; b1: number; b2: number; a1: number; a2: number }): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

const kWeight = (ch: Float32Array) => biquad(biquad(ch, STAGE1), STAGE2);

/**
 * Integrated loudness (LUFS) per BS.1770-4. `channels` are full-signal PCM at
 * 48 kHz; channel weights are 1.0 for L/R (mono/stereo — the Music Lab case).
 * Returns null below the absolute gate, when shorter than one 400 ms block, or
 * when not 48 kHz.
 */
export function computeLufsIntegrated(channels: Float32Array[], sampleRate: number): number | null {
  if (sampleRate !== R128_RATE || channels.length === 0) return null;
  const n = channels[0].length;
  const blockSize = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  if (n < blockSize) return null;

  const weighted = channels.map(kWeight);
  // Mean-square loudness z for each 400 ms block (summed across channels).
  const blocks: number[] = [];
  for (let start = 0; start + blockSize <= n; start += step) {
    let z = 0;
    for (const w of weighted) {
      let ss = 0;
      for (let i = start; i < start + blockSize; i++) ss += w[i] * w[i];
      z += ss / blockSize;
    }
    blocks.push(z);
  }
  if (blocks.length === 0) return null;

  const loudness = (z: number) => -0.691 + 10 * Math.log10(z);
  const absZ = Math.pow(10, (ABS_GATE_LUFS + 0.691) / 10);

  // Absolute gate.
  const gated1 = blocks.filter((z) => z > absZ);
  if (gated1.length === 0) return null;

  // Relative gate = mean loudness of abs-gated blocks − 10 LU.
  const meanZ1 = gated1.reduce((a, b) => a + b, 0) / gated1.length;
  const relThreshZ = Math.pow(10, (loudness(meanZ1) + REL_GATE_LU + 0.691) / 10);
  const gated2 = gated1.filter((z) => z >= relThreshZ);
  if (gated2.length === 0) return null;

  const meanZ2 = gated2.reduce((a, b) => a + b, 0) / gated2.length;
  return Math.round(loudness(meanZ2) * 10) / 10;
}

/** Peak / RMS / crest / clip% — exact, sample-rate-independent. */
export function computeAudioMetrics(channels: Float32Array[], sampleRate: number): AudioMetrics {
  const n = channels[0]?.length ?? 0;
  let peak = 0;
  let sumSq = 0;
  let clipped = 0;
  let count = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
      if (a >= CLIP_THRESHOLD) clipped++;
      sumSq += ch[i] * ch[i];
      count++;
    }
  }
  const rms = count ? Math.sqrt(sumSq / count) : 0;
  const toDb = (x: number) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -Infinity);
  const peakDbfs = toDb(peak);
  const rmsDbfs = toDb(rms);
  return {
    durationSec: sampleRate ? Math.round((n / sampleRate) * 10) / 10 : 0,
    peakDbfs,
    rmsDbfs,
    crestDb: Number.isFinite(peakDbfs) && Number.isFinite(rmsDbfs) ? Math.round((peakDbfs - rmsDbfs) * 10) / 10 : 0,
    clipPct: count ? Math.round((clipped / count) * 1000) / 10 : 0,
    lufsIntegrated: computeLufsIntegrated(channels, sampleRate),
  };
}
