/** @jest-environment node */
/**
 * Measuring two Suno generations against each other.
 *
 * The DSP is tested against SYNTHESISED signals with known answers — a click
 * train at a known tempo, a sine at a known pitch — because a test that feeds
 * real audio and asserts whatever the code returned proves only that the code
 * is unchanged, not that it is right.
 *
 * The advice layer is tested against the real measurements from
 * காணாமல் போன ஆடாக on 2026-09-17, which is the case that motivated all of it.
 */
import {
  onsetEnvelope, estimateTempo, beatPhase, firstOnsetSec,
  chroma, spectralCentroid, chromaCorrelation, bestPitchShift, tonalCentre,
  comparePartsAndSuggest, suggestJoin,
  ANALYSIS_SR, ANALYSIS_FPS, PITCH_NAMES,
  type PartMeasurement,
} from '@/lib/part-analysis';

/** A click every `periodSec`, which is the simplest thing with a known tempo. */
function clickTrain(seconds: number, periodSec: number, offsetSec = 0): Float32Array {
  const x = new Float32Array(Math.round(seconds * ANALYSIS_SR));
  for (let t = offsetSec; t < seconds; t += periodSec) {
    const i = Math.round(t * ANALYSIS_SR);
    for (let k = 0; k < 40 && i + k < x.length; k++) x[i + k] = (1 - k / 40) * (k % 2 ? -1 : 1);
  }
  return x;
}

function sine(seconds: number, freq: number): Float32Array {
  const x = new Float32Array(Math.round(seconds * ANALYSIS_SR));
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * freq * i) / ANALYSIS_SR);
  return x;
}

describe('tempo, against a signal whose tempo is known', () => {
  it.each([
    [0.5, 120],
    [0.4, 150],
    [0.34, 176.5],
  ])('a click every %ss reads as %s BPM', (period, bpm) => {
    const t = estimateTempo(onsetEnvelope(clickTrain(20, period)))!;
    expect(t).not.toBeNull();
    expect(t.bpm).toBeCloseTo(bpm, 0);
  });

  it('resolves a difference finer than one analysis frame', () => {
    // 176.2 vs 179.1 BPM is the real case — periods 0.3406s and 0.3351s, which
    // are one 5 ms frame apart. Without interpolation both would read the same.
    const a = estimateTempo(onsetEnvelope(clickTrain(25, 60 / 176.2)))!;
    const b = estimateTempo(onsetEnvelope(clickTrain(25, 60 / 179.1)))!;
    expect(a.bpm).not.toBeCloseTo(b.bpm, 1);
    expect(Math.abs(a.bpm - b.bpm)).toBeGreaterThan(1.5);
  });

  it('reports LOW confidence on material with no beat in it', () => {
    // A steady tone has no transients — the figure must be flagged, not quoted.
    const t = estimateTempo(onsetEnvelope(sine(20, 220)));
    expect(t === null || t.confidence < 0.5).toBe(true);
  });

  it('returns null rather than guessing from too little audio', () => {
    expect(estimateTempo(onsetEnvelope(clickTrain(0.2, 0.5)))).toBeNull();
  });

  it('finds the beat phase', () => {
    const env = onsetEnvelope(clickTrain(20, 0.5, 0.25));
    const lag = Math.round(0.5 * ANALYSIS_FPS);
    expect(beatPhase(env, lag) / ANALYSIS_FPS).toBeCloseTo(0.25, 1);
  });

  it('finds where the music starts', () => {
    // Two seconds of silence, then clicks.
    expect(firstOnsetSec(onsetEnvelope(clickTrain(20, 0.5, 2.0)))).toBeCloseTo(2.0, 1);
  });
});

describe('pitch, against a signal whose pitch is known', () => {
  it.each([
    [440, 'A'],
    [261.63, 'C'],
    [329.63, 'E'],
    [311.13, 'D#'],
  ])('%s Hz reads as %s', (freq, name) => {
    expect(tonalCentre(chroma(sine(2, freq)))).toBe(name);
  });

  it('is octave-invariant, which is what a pitch CLASS means', () => {
    expect(tonalCentre(chroma(sine(2, 220)))).toBe(tonalCentre(chroma(sine(2, 440))));
  });

  it('scores identical material as identical, and a semitone apart as not', () => {
    const e = chroma(sine(2, 329.63));   // E
    const eb = chroma(sine(2, 311.13));  // E♭
    expect(chromaCorrelation(e, e)).toBeCloseTo(1, 5);
    expect(chromaCorrelation(e, eb)).toBeLessThan(0.5);
  });

  it('works out how far B would have to move to meet A', () => {
    const a = chroma(sine(2, 329.63));   // E
    const b = chroma(sine(2, 311.13));   // E♭, a semitone below
    const shift = bestPitchShift(a, b);
    expect(shift.semitones).toBe(1);     // B moves UP one to reach A
    expect(shift.correlation).toBeGreaterThan(0.9);
  });

  it('brightness separates a low tone from a high one', () => {
    expect(spectralCentroid(sine(2, 200))).toBeLessThan(spectralCentroid(sine(2, 1200)));
  });

  it('survives degenerate input without throwing', () => {
    expect(chroma(new Float32Array(0))).toHaveLength(12);
    expect(spectralCentroid(new Float32Array(1))).toBe(0);
    expect(PITCH_NAMES).toHaveLength(12);
  });
});

/**
 * The real case. Every number here was measured on Raj's actual files on
 * 2026-09-17 — the analysis has to reach the same conclusions he and I reached
 * by hand, or it is not worth showing him.
 */
describe('காணாமல் போன ஆடாக, as measured', () => {
  const E = chroma(sine(2, 329.63));
  const Eb = chroma(sine(2, 311.13));
  const A: PartMeasurement = {
    durationSec: 222.0, edgeLufs: -19.2, centroidHz: 327, chroma: E,
    tempo: { bpm: 176.15, periodSec: 0.3406, phaseSec: 0.065, confidence: 0.8 },
  };
  const B: PartMeasurement = {
    durationSec: 224.72, edgeLufs: -18.7, centroidHz: 565, chroma: Eb,
    tempo: { bpm: 179.07, periodSec: 0.3351, phaseSec: 0.075, confidence: 0.8 },
    firstOnsetSec: 0.1,
  };

  it('clears the level and flags the other three', () => {
    const r = comparePartsAndSuggest(A, B);
    const by = (id: string) => r.findings.find((f) => f.id === id)!;
    expect(by('level').level).toBe('ok');
    expect(by('tempo').level).toBe('warn');
    expect(by('key').level).toBe('warn');
    expect(by('brightness').level).toBe('warn');
  });

  it('says a semitone, and says a crossfade will not fix it', () => {
    const key = comparePartsAndSuggest(A, B).findings.find((f) => f.id === 'key')!;
    expect(key.text).toMatch(/1 semitone apart/);
    expect(key.text).toMatch(/No crossfade fixes this/i);
  });

  it('tells the operator to keep the crossfade SHORT when tempos differ', () => {
    // The counter-intuitive one — the instinct is to lengthen it.
    const t = comparePartsAndSuggest(A, B).findings.find((f) => f.id === 'tempo')!;
    expect(t.text).toMatch(/SHORT/);
    expect(t.text).toMatch(/drifts further/);
  });

  it('suggests the window we arrived at by hand', () => {
    const s = suggestJoin(A, B)!;
    expect(s.partBStartSec).toBe(0.1);
    expect(s.overlapSec).toBeCloseTo(2.11, 1);
    expect(s.reason).toMatch(/short because the tempos differ/);
  });

  it('every suggested length lands on one of A’s beats', () => {
    // The whole point of the number: B's entry has to coincide with a beat in
    // A, or the join trips however long the crossfade is.
    const s = suggestJoin(A, B)!;
    const gridOrigin = A.durationSec - 25 + A.tempo!.phaseSec;
    for (const d of [s.overlapSec, ...s.alternatives]) {
      const beatsFromOrigin = (A.durationSec - d - gridOrigin) / A.tempo!.periodSec;
      expect(Math.abs(beatsFromOrigin - Math.round(beatsFromOrigin))).toBeLessThan(0.02);
    }
  });

  it('does not suggest a crossfade so short it reads as a cut', () => {
    const s = suggestJoin(A, B)!;
    expect(s.overlapSec).toBeGreaterThanOrEqual(2.0);
  });

  it('is NOT called joinable when key and timbre disagree', () => {
    expect(comparePartsAndSuggest(A, B).joinable).toBe(false);
  });

  it('two matching parts pass everything and get a longer, comfortable crossfade', () => {
    const b2: PartMeasurement = { ...B, chroma: E, centroidHz: 330, tempo: { ...A.tempo! } };
    const r = comparePartsAndSuggest(A, b2);
    expect(r.findings.every((f) => f.level === 'ok')).toBe(true);
    expect(r.joinable).toBe(true);
    // With no tempo drift to worry about it aims near 3s rather than the shortest.
    expect(r.suggestion!.overlapSec).toBeGreaterThan(2.4);
  });
});
