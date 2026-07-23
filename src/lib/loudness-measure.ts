/**
 * Pure parsing of ffmpeg's `ebur128`+`astats` (measurement) and `loudnorm`
 * (two-pass mastering) stderr — the brains of the Music Lab audio functions
 * (`worker/measure-fn.ts`, `worker/master-worker.ts`). Kept pure + framework-free
 * so it's unit-testable and validated against REAL ffmpeg output (see the test).
 *
 * Streaming target: -14 LUFS integrated, -1 dBTP true-peak ceiling.
 *
 * CRITICAL: `ebur128` prints a per-frame `t: … I: … LRA: … TPK: …` line for the
 * WHOLE track, THEN a Summary block at the end. We parse ONLY the Summary region
 * (after the last "Summary:") so the integrated/LRA/true-peak values are the
 * final ones — not the first per-frame sample.
 */

export type MeasureStatus = 'ok' | 'hot' | 'quiet';
export type MeasureVerdict = MeasureStatus | 'clip-risk' | 'squashed';

export interface LoudnessMetrics {
  /** Integrated loudness (LUFS). */
  lufs: number;
  /** Loudness range (LU). */
  lra: number;
  /** True peak (dBFS / dBTP). */
  truePeak: number;
  /** Crest factor = Peak level dB − RMS level dB (dynamics), 1 dp. */
  crest: number;
  /** astats flat factor (>0 ⇒ flat-topped / likely clipped). */
  flatFactor: number;
}

export interface MeasureResult {
  metrics: LoudnessMetrics;
  badge: string;
  verdict: MeasureVerdict;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** parseFloat that understands ffmpeg's "-inf"/"inf" (silence). */
function num(s: string | undefined): number {
  if (s == null) return NaN;
  if (/^-?inf$/i.test(s)) return s[0] === '-' ? -Infinity : Infinity;
  return parseFloat(s);
}
function matchNum(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? num(m[1]) : NaN;
}

/** The ebur128 Summary region (everything after the final "Summary:"). */
function summaryRegion(stderr: string): string {
  const i = stderr.lastIndexOf('Summary:');
  return i >= 0 ? stderr.slice(i) : stderr;
}

/** Badge + verdict from the metrics. Pure; mirrors the spec precedence. */
export function badgeAndVerdict(
  m: Pick<LoudnessMetrics, 'lufs' | 'truePeak' | 'flatFactor' | 'crest'>,
  target = -14
): { badge: string; status: MeasureStatus; verdict: MeasureVerdict } {
  const delta = round1(m.lufs - target);
  let status: MeasureStatus;
  let badge: string;
  if (Math.abs(delta) <= 1) {
    status = 'ok';
    badge = `on-target (${target})`;
  } else if (delta > 0) {
    status = 'hot';
    badge = `+${delta} LU hot`;
  } else {
    status = 'quiet';
    badge = `${Math.abs(delta)} LU quiet`;
  }

  let verdict: MeasureVerdict;
  if (m.truePeak > -1 || m.flatFactor > 0) verdict = 'clip-risk';
  else if (Number.isFinite(m.crest) && m.crest < 6) verdict = 'squashed';
  else verdict = status;

  return { badge, status, verdict };
}

/** Parse a measurement pass (ebur128 + astats) into metrics + badge + verdict. */
export function parseMeasurement(stderr: string, target = -14): MeasureResult {
  const sum = summaryRegion(stderr);
  const lufs = matchNum(sum, /I:\s+(-?\d+(?:\.\d+)?|-?inf)\s+LUFS/i);
  const lra = matchNum(sum, /LRA:\s+(-?\d+(?:\.\d+)?|-?inf)\s+LU/i);
  const truePeak = matchNum(sum, /Peak:\s+(-?\d+(?:\.\d+)?|-?inf)\s+dBFS/i);

  // astats labels are unique (no per-frame collision) — search the whole log.
  const peakLevelDb = matchNum(stderr, /Peak level dB:\s+(-?\d+(?:\.\d+)?|-?inf)/i);
  const rmsLevelDb = matchNum(stderr, /RMS level dB:\s+(-?\d+(?:\.\d+)?|-?inf)/i);
  const flatFactor = matchNum(stderr, /Flat factor:\s+(-?\d+(?:\.\d+)?|-?inf)/i);
  const crest =
    Number.isFinite(peakLevelDb) && Number.isFinite(rmsLevelDb) ? round1(peakLevelDb - rmsLevelDb) : NaN;

  const metrics: LoudnessMetrics = { lufs, lra, truePeak, crest, flatFactor };
  const { badge, verdict } = badgeAndVerdict(metrics, target);
  return { metrics, badge, verdict };
}

// ---------------------------------------------------------------------------
// Mastering — loudnorm two-pass
// ---------------------------------------------------------------------------

export interface LoudnormStats {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

/** Parse the JSON block loudnorm pass 1 prints to stderr (last {...}). */
export function parseLoudnormStats(stderr: string): LoudnormStats | null {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: Record<string, string>;
  try {
    obj = JSON.parse(stderr.slice(start, end + 1));
  } catch {
    return null;
  }
  const stats: LoudnormStats = {
    input_i: parseFloat(obj.input_i),
    input_tp: parseFloat(obj.input_tp),
    input_lra: parseFloat(obj.input_lra),
    input_thresh: parseFloat(obj.input_thresh),
    target_offset: parseFloat(obj.target_offset),
  };
  return Object.values(stats).every((v) => Number.isFinite(v)) ? stats : null;
}

/** The pass-2 linear loudnorm filter string from pass-1 measurements. */
export function buildPass2Loudnorm(stats: LoudnormStats, target = -14): string {
  return (
    `loudnorm=I=${target}:TP=-1:LRA=11` +
    `:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}` +
    `:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}` +
    `:offset=${stats.target_offset}:linear=true`
  );
}

/** loudnorm accepts an integrated target in [-70, -5]; outside that ffmpeg errors. */
export const MIN_TARGET_LUFS = -70;
export const MAX_TARGET_LUFS = -5;

export const isValidTarget = (t: unknown): t is number =>
  typeof t === 'number' && Number.isFinite(t) && t >= MIN_TARGET_LUFS && t <= MAX_TARGET_LUFS;

/**
 * S3 key for a mastering output. The target is part of the name so the same
 * source mastered for Spotify (-14) and Apple (-16) yields two files instead of
 * the second silently overwriting the first, and the source extension is
 * replaced rather than appended (`song.wav` → `song-master-14LUFS.wav`, not
 * `song.wav-master.wav`).
 */
export function masterKeyFor(s3Key: string, target: number): string {
  const stem = s3Key.replace(/\.[a-z0-9]+$/i, '');
  return `${stem}-master-${String(Math.abs(target)).replace('.', '_')}LUFS.wav`;
}

/**
 * True if the key is itself a mastering output. Re-mastering one compounds the
 * correction on an already-corrected file, so both routes refuse it. Also
 * matches the legacy `<key>-master.wav` shape written before targets were named.
 */
export function isMasterKey(s3Key: string): boolean {
  return /-master(-\d+(?:_\d+)?LUFS)?\.wav$/i.test(s3Key);
}

/** The single measurement-pass ffmpeg args (used by measure-fn). */
export function measureArgs(input: string): string[] {
  return [
    '-hide_banner', '-nostats', '-i', input,
    '-af', 'ebur128=peak=true,astats=metadata=1:measure_perchannel=0',
    '-f', 'null', '-',
  ];
}
