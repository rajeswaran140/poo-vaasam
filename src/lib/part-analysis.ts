/**
 * Measuring two generations against each other, before they are joined.
 *
 * WHY. Long lyrics force a song to be composed as two separate Suno
 * generations, and nothing makes those share a key, a tempo or a tonal
 * balance. When a join "sounds like two songs" it is usually because it IS two
 * songs — and the crossfade, which is the only thing the panel let you adjust,
 * is the one part that was already correct.
 *
 * On 2026-09-17 this was worked out by hand for காணாமல் போன ஆடாக: Part A at
 * 176.2 BPM, E-centred, 327 Hz centroid; Part B at 179.1 BPM, E♭, 565 Hz. Level
 * matched, everything else did not. This module is that analysis, made routine.
 *
 * ⚠️ IT ADVISES, IT DOES NOT DECIDE. The suggestion is a starting point for the
 * ear, not an answer. Beat detection on melodic material is genuinely uncertain
 * — `confidence` says how much to trust each figure, and the UI must show it.
 * An automatic guess presented as fact is worse than no guess, because it gets
 * believed.
 *
 * Pure: samples in, numbers out. No ffmpeg, no AWS, no clock.
 */

/** Analysis runs on mono at this rate — plenty for beat and pitch, and cheap. */
export const ANALYSIS_SR = 8000;
/** Onset envelope resolution: 5 ms frames. */
export const ANALYSIS_FPS = 200;

export const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Tempo search range. Tamil film/folk material sits well inside this. */
export const MIN_BPM = 60;
export const MAX_BPM = 190;

/**
 * A level step at or beyond this is not a placement problem — it is heard as a
 * different recording starting, and no crossfade hides it.
 */
export const LEVEL_GAP_LU = 1.5;
/** Below this the two parts are the same tempo as far as a listener is concerned. */
export const TEMPO_TOLERANCE_PCT = 0.5;
/** Brightness ratio beyond this reads as a different mix. */
export const BRIGHTNESS_TOLERANCE_PCT = 25;

// ---------------------------------------------------------------------------
// Onsets and tempo
// ---------------------------------------------------------------------------

/**
 * Onset strength per frame — high-passed energy flux.
 *
 * The first difference acts as a high-pass, which emphasises attacks over
 * sustain. Crude next to a spectral-flux detector, and deliberately so: it has
 * no dependencies, runs in a Lambda in milliseconds, and a downbeat is exactly
 * the kind of broadband transient it responds to.
 */
export function onsetEnvelope(samples: ArrayLike<number>, fps = ANALYSIS_FPS, sr = ANALYSIS_SR): number[] {
  const hop = Math.max(1, Math.round(sr / fps));
  const n = Math.floor(samples.length / hop);
  const energy = new Array<number>(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop, end = Math.min((i + 1) * hop, samples.length); j < end; j++) {
      const d = samples[j] - prev;
      prev = samples[j];
      sum += d * d;
    }
    energy[i] = Math.log1p(sum);
  }
  const flux = new Array<number>(Math.max(0, n - 1));
  for (let i = 1; i < n; i++) flux[i - 1] = Math.max(0, energy[i] - energy[i - 1]);
  return flux;
}

export interface TempoEstimate {
  bpm: number;
  /** Beat period in seconds. */
  periodSec: number;
  /** Offset of the beat grid within the analysed window, seconds. */
  phaseSec: number;
  /**
   * 0-1. The autocorrelation peak's height over the mean — low means the
   * material is not percussive enough to read a beat from, and the figure
   * should be shown as uncertain rather than quoted.
   */
  confidence: number;
}

/**
 * Tempo by autocorrelation of the onset envelope, refined by parabolic
 * interpolation — 5 ms frames quantise more coarsely than the differences that
 * matter (1.66% at 176 BPM is under one frame).
 */
export function estimateTempo(env: number[], fps = ANALYSIS_FPS): TempoEstimate | null {
  if (env.length < fps) return null;
  const lo = Math.floor((fps * 60) / MAX_BPM);
  const hi = Math.ceil((fps * 60) / MIN_BPM);
  if (hi <= lo || env.length <= hi) return null;

  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const x = env.map((v) => v - mean);
  const scores = new Map<number, number>();
  let best = -Infinity;
  let bestLag = lo;
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i < x.length - lag; i++) s += x[i] * x[i + lag];
    s /= x.length - lag;
    scores.set(lag, s);
    if (s > best) { best = s; bestLag = lag; }
  }

  const y0 = scores.get(bestLag - 1) ?? best;
  const y1 = best;
  const y2 = scores.get(bestLag + 1) ?? best;
  const denom = y0 - 2 * y1 + y2;
  const delta = denom ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;
  const lag = bestLag + delta;

  // ⚠️ Confidence must NOT be (best - mean) / (max - mean): `best` is the max,
  // so that expression is 1 for every input including pure noise. Measure the
  // peak's height in standard deviations instead — a real periodicity stands
  // many sigma above the mean, noise stands one or two.
  const all = [...scores.values()];
  const avg = all.reduce((p, q) => p + q, 0) / all.length;
  const variance = all.reduce((p, q) => p + (q - avg) ** 2, 0) / all.length;
  const sd = Math.sqrt(variance);
  const envMean = env.reduce((p, q) => p + q, 0) / env.length;
  // A steady tone produces almost no onset flux; there is nothing to read a
  // beat from, whatever the autocorrelation says about its own noise.
  const hasTransients = envMean > 1e-6;
  const z = sd > 0 ? (best - avg) / sd : 0;
  const confidence = hasTransients ? Math.max(0, Math.min(1, (z - 1) / 4)) : 0;

  return {
    bpm: (60 * fps) / lag,
    periodSec: lag / fps,
    phaseSec: beatPhase(env, Math.round(lag)) / fps,
    confidence,
  };
}

/** Which offset within one beat period carries the most onset energy. */
export function beatPhase(env: number[], lagFrames: number): number {
  if (lagFrames <= 0) return 0;
  let best = -Infinity;
  let bestOff = 0;
  for (let off = 0; off < lagFrames; off++) {
    let s = 0;
    for (let i = off; i < env.length; i += lagFrames) s += env[i];
    if (s > best) { best = s; bestOff = off; }
  }
  return bestOff;
}

/** Where the music actually begins — the first frame reaching a share of the peak. */
export function firstOnsetSec(env: number[], fraction = 0.35, fps = ANALYSIS_FPS): number {
  const peak = Math.max(0, ...env);
  if (peak <= 0) return 0;
  const i = env.findIndex((v) => v >= peak * fraction);
  return i < 0 ? 0 : i / fps;
}

// ---------------------------------------------------------------------------
// Pitch and timbre
// ---------------------------------------------------------------------------

/**
 * Energy per pitch class, C2..C6 folded into twelve bins.
 *
 * A direct DFT at the semitone frequencies rather than an FFT: 49 bins is
 * cheaper than a transform, and it puts the bins exactly on the notes instead
 * of interpolating between them.
 */
export function chroma(samples: ArrayLike<number>, sr = ANALYSIS_SR): number[] {
  const n = samples.length;
  if (n < 2) return new Array(12).fill(0);
  const out = new Array<number>(12).fill(0);
  for (let midi = 36; midi <= 84; midi++) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    if (f > sr * 0.45) continue;
    const k = (2 * Math.PI * f) / sr;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const v = samples[i] * w;
      re += v * Math.cos(k * i);
      im -= v * Math.sin(k * i);
    }
    out[midi % 12] += Math.hypot(re, im);
  }
  const total = out.reduce((a, b) => a + b, 0) || 1;
  return out.map((v) => v / total);
}

/** Brightness, in Hz. A crude timbre figure — but a big difference is a real one. */
export function spectralCentroid(samples: ArrayLike<number>, sr = ANALYSIS_SR): number {
  const n = samples.length;
  if (n < 2) return 0;
  let num = 0;
  let den = 0;
  for (let f = 80; f < sr * 0.45; f += 40) {
    const k = (2 * Math.PI * f) / sr;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const v = samples[i] * w;
      re += v * Math.cos(k * i);
      im -= v * Math.sin(k * i);
    }
    const m = Math.hypot(re, im);
    num += f * m;
    den += m;
  }
  return den ? num / den : 0;
}

/** Correlation between two chroma vectors. 1 = same tonal centre, 0 = unrelated. */
export function chromaCorrelation(a: number[], b: number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / 12;
  const mb = b.reduce((x, y) => x + y, 0) / 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da) * Math.sqrt(db);
  return den ? num / den : 0;
}

/**
 * How many semitones Part B would have to move UP to sit on Part A's centre,
 * and how well it would then match. 0 means they already agree.
 *
 * ⚠️ The rotation index is NOT the musical interval. Rotating the chroma array
 * left by `r` compares a[i] against b[(i+r)%12] — which is B's content moved
 * UP by (12 − r) semitones. Reporting `r` directly said "11 semitones apart"
 * for two parts a single semitone apart, which is the same fact stated in the
 * most alarming possible way.
 */
export function bestPitchShift(a: number[], b: number[]): { semitones: number; correlation: number } {
  let best = { semitones: 0, correlation: chromaCorrelation(a, b) };
  for (let r = 1; r < 12; r++) {
    const rotated = b.slice(r).concat(b.slice(0, r));
    const c = chromaCorrelation(a, rotated);
    if (c > best.correlation) best = { semitones: (12 - r) % 12, correlation: c };
  }
  return best;
}

/** The pitch class carrying most energy. */
export function tonalCentre(c: number[]): string {
  let bi = 0;
  for (let i = 1; i < 12; i++) if (c[i] > c[bi]) bi = i;
  return PITCH_NAMES[bi];
}

// ---------------------------------------------------------------------------
// Comparing the two parts, and what to do about it
// ---------------------------------------------------------------------------

export interface PartMeasurement {
  durationSec: number;
  /** Integrated loudness of the region that will overlap. */
  edgeLufs: number | null;
  tempo: TempoEstimate | null;
  chroma: number[];
  centroidHz: number;
  /** Part B only: where its music actually starts. */
  firstOnsetSec?: number;
}

export type FindingLevel = 'ok' | 'warn';

export interface Finding {
  id: 'level' | 'tempo' | 'key' | 'brightness';
  level: FindingLevel;
  /** One line, in the operator's words. */
  text: string;
}

export interface JoinSuggestion {
  /** Head trim for Part B, so it opens on its own downbeat. */
  partBStartSec: number;
  /** Crossfade length, chosen to land B's entry on one of A's beats. */
  overlapSec: number;
  /** Other on-grid lengths, nearest first, if the suggestion is not to taste. */
  alternatives: number[];
  /** Why this length and not another. */
  reason: string;
}

export interface PartComparison {
  a: PartMeasurement;
  b: PartMeasurement;
  findings: Finding[];
  suggestion: JoinSuggestion | null;
  /**
   * True when nothing but the level differs — i.e. a crossfade can actually
   * make this sound like one song.
   */
  joinable: boolean;
}

const pct = (a: number, b: number) => (Math.abs(a - b) / ((a + b) / 2)) * 100;

export function comparePartsAndSuggest(a: PartMeasurement, b: PartMeasurement): PartComparison {
  const findings: Finding[] = [];

  if (a.edgeLufs !== null && b.edgeLufs !== null) {
    const gap = Math.round(Math.abs(a.edgeLufs - b.edgeLufs) * 10) / 10;
    findings.push(gap >= LEVEL_GAP_LU
      ? { id: 'level', level: 'warn', text: `Level ${gap} LU apart — no crossfade hides a step that size. Match the parts first.` }
      : { id: 'level', level: 'ok', text: `Level ${gap} LU apart — close enough that placement decides this seam.` });
  }

  if (a.tempo && b.tempo) {
    const d = Math.round(pct(a.tempo.bpm, b.tempo.bpm) * 100) / 100;
    findings.push(d >= TEMPO_TOLERANCE_PCT
      ? { id: 'tempo', level: 'warn', text: `Tempo ${d}% apart — keep the crossfade SHORT; a longer one drifts further.` }
      : { id: 'tempo', level: 'ok', text: `Tempo within ${d}% — the halves will stay together across the overlap.` });
  }

  const shift = bestPitchShift(a.chroma, b.chroma);
  if (shift.semitones === 0) {
    findings.push({ id: 'key', level: 'ok', text: `Same tonal centre (${tonalCentre(a.chroma)}).` });
  } else {
    // Report the nearer direction: 11 up is 1 down, and the smaller number is
    // the one a musician would say.
    const n = Math.min(shift.semitones, 12 - shift.semitones);
    findings.push({
      id: 'key', level: 'warn',
      text: `Different key — ${tonalCentre(a.chroma)} against ${tonalCentre(b.chroma)}, about ${n} semitone${n === 1 ? '' : 's'} apart. No crossfade fixes this.`,
    });
  }

  if (a.centroidHz > 0 && b.centroidHz > 0) {
    const d = Math.round(pct(a.centroidHz, b.centroidHz));
    findings.push(d >= BRIGHTNESS_TOLERANCE_PCT
      ? { id: 'brightness', level: 'warn', text: `Part ${b.centroidHz > a.centroidHz ? 'B' : 'A'} is ${d}% brighter — they will read as different recordings.` }
      : { id: 'brightness', level: 'ok', text: `Tonal balance within ${d}%.` });
  }

  return {
    a, b, findings,
    suggestion: suggestJoin(a, b),
    joinable: findings.every((f) => f.level === 'ok' || f.id === 'level'),
  };
}

/**
 * Where to put the seam.
 *
 * Two independent decisions. Part B is trimmed to its own first onset so it
 * opens on a downbeat rather than on a fraction of one. Then, because
 * `acrossfade=d=D` makes B enter at (A's length − D), D is chosen so that entry
 * lands ON one of A's beats — which is what stops the join tripping.
 *
 * Short is preferred when the tempos disagree: drift across the overlap is
 * proportional to its length, so the instinct to lengthen a rough crossfade is
 * backwards.
 */
export function suggestJoin(a: PartMeasurement, b: PartMeasurement): JoinSuggestion | null {
  if (!a.tempo || !Number.isFinite(a.durationSec) || a.durationSec <= 0) return null;

  const { periodSec, phaseSec } = a.tempo;
  if (!(periodSec > 0)) return null;

  // A's beat grid, in Part A's own timeline. phaseSec is measured inside the
  // analysed window, which sits at the END of Part A.
  const windowStart = Math.max(0, a.durationSec - analysisWindowSec(a.durationSec));
  const firstBeat = windowStart + phaseSec;

  const onGrid: number[] = [];
  for (let t = firstBeat; t <= a.durationSec; t += periodSec) {
    const d = Math.round((a.durationSec - t) * 1000) / 1000;
    if (d >= MIN_SUGGESTED_OVERLAP && d <= MAX_SUGGESTED_OVERLAP) onGrid.push(d);
  }
  if (!onGrid.length) return null;
  onGrid.sort((x, y) => x - y);

  const tempoDiffers =
    !!a.tempo && !!b.tempo && pct(a.tempo.bpm, b.tempo.bpm) >= TEMPO_TOLERANCE_PCT;

  // Shortest on-grid when the tempos differ; otherwise the one nearest a
  // comfortable 3s, which is long enough to feel like a join and short enough
  // not to blur a section change.
  // Short when the tempos differ — but not arbitrarily short. Below about two
  // seconds a crossfade stops sounding like a join and starts sounding like a
  // cut, so the shortest ON-GRID length at or above that floor wins, and the
  // true shortest is only used when the grid offers nothing else.
  const pick = tempoDiffers
    ? onGrid.find((v) => v >= PREFERRED_MIN_OVERLAP) ?? onGrid[0]
    : onGrid.reduce((best, v) => (Math.abs(v - 3) < Math.abs(best - 3) ? v : best), onGrid[0]);

  return {
    partBStartSec: Math.round((b.firstOnsetSec ?? 0) * 100) / 100,
    overlapSec: pick,
    alternatives: onGrid.filter((v) => v !== pick).slice(0, 4),
    reason: tempoDiffers
      ? 'on Part A’s beat grid, and short because the tempos differ'
      : 'on Part A’s beat grid',
  };
}

/** Shortest and longest crossfade worth suggesting. */
export const MIN_SUGGESTED_OVERLAP = 1.5;
/** Below this a crossfade reads as a cut rather than a join. */
export const PREFERRED_MIN_OVERLAP = 2.0;
export const MAX_SUGGESTED_OVERLAP = 5.0;

/** How much of each part gets analysed. Matches what the worker decodes. */
export function analysisWindowSec(durationSec: number): number {
  return Math.min(25, Math.max(5, durationSec));
}
