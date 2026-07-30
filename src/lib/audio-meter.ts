/**
 * Level metering for the mastering player — pure sample maths, no Web Audio.
 *
 * WHY A METER BELONGS HERE. The mastering module's stated value is PEAK SAFETY,
 * not loudness: the worker's job is to land at target without letting a true
 * peak run into 0 dBFS. The job record already proves that after the fact
 * (`afterTp`), but there was no way to WATCH it while auditioning. This is that
 * — a live confirmation that what you are hearing is behaving like the numbers
 * claim.
 *
 * Sample-peak, not true-peak. Inter-sample peaks need oversampling that a
 * realtime AnalyserNode does not give us, so a reading here can sit slightly
 * BELOW the true peak the worker measured. The UI must therefore never present
 * this as the authoritative figure — `afterTp` on the job is that.
 */

/** Below this, treat as silence rather than reporting -Infinity. */
export const METER_FLOOR_DB = -60;

/** Delivery ceiling the catalogue masters to; above it, flag. */
export const TRUE_PEAK_CEILING_DB = -1;

/**
 * Amplitude (0..1) to dBFS. Returns METER_FLOOR_DB for silence rather than
 * -Infinity, which would break every bar-width calculation downstream.
 */
export function toDb(amplitude: number): number {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return METER_FLOOR_DB;
  const db = 20 * Math.log10(amplitude);
  return db < METER_FLOOR_DB ? METER_FLOOR_DB : db;
}

export interface LevelReading {
  /** Highest absolute sample in the block, dBFS. */
  peakDb: number;
  /** Root-mean-square of the block, dBFS — tracks perceived level. */
  rmsDb: number;
  /** True when the block reached or exceeded the delivery ceiling. */
  overCeiling: boolean;
  /** True when a sample hit full scale — actual clipping, not just hot. */
  clipped: boolean;
}

/** Measure one block of samples. */
export function measureBlock(samples: Float32Array | number[]): LevelReading {
  let peak = 0;
  let sumSquares = 0;
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const v = samples[i];
    if (!Number.isFinite(v)) continue;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSquares += v * v;
  }
  const rms = n > 0 ? Math.sqrt(sumSquares / n) : 0;
  const peakDb = toDb(peak);
  return {
    peakDb,
    rmsDb: toDb(rms),
    overCeiling: peakDb > TRUE_PEAK_CEILING_DB,
    // >= 1 is full scale. Float samples can exceed it after processing, so this
    // is >=, not ===.
    clipped: peak >= 1,
  };
}

/**
 * Position a dB value on a 0..1 bar.
 *
 * Linear in dB, not in amplitude: an amplitude-linear meter spends most of its
 * width on the top 6 dB and makes everything below -20 look identical, which
 * is useless for judging a master sitting at -14.
 */
export function barFraction(db: number, floorDb: number = METER_FLOOR_DB): number {
  if (!Number.isFinite(db)) return 0;
  if (db <= floorDb) return 0;
  if (db >= 0) return 1;
  return (db - floorDb) / (0 - floorDb);
}

/**
 * Decay a held peak toward the current one.
 *
 * A meter that follows samples exactly is unreadable — a transient flashes for
 * one frame. Holding the peak and easing it down is how hardware meters behave
 * and is the only way a human catches a brief overshoot.
 */
export function decayPeak(held: number, current: number, decayDbPerFrame = 0.8): number {
  if (current >= held) return current;
  const next = held - decayDbPerFrame;
  return next < current ? current : next;
}
