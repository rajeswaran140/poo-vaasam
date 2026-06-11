/** @jest-environment node */
/**
 * UNIT TESTS — pure retention-analysis helpers.
 */
import {
  parseRetentionRows,
  watchRatioAtRatio,
  holdAtSeconds,
  summarizeCurve,
  classifyHook,
  analyzeRetention,
  VERDICT_CHECKPOINT,
  type RetentionCurve,
} from '@/lib/youtube-retention';

// A template-shaped curve (holds well early) and a weak one (drops fast).
const strongRows: Array<[number, number]> = [
  [0, 1.07], [0.05, 0.8], [0.1, 0.73], [0.15, 0.64], [0.25, 0.6], [0.5, 0.49], [0.75, 0.42], [1, 0.36],
];
const weakRows: Array<[number, number]> = [
  [0, 1.0], [0.05, 0.55], [0.1, 0.4], [0.15, 0.3], [0.25, 0.22], [0.5, 0.12], [1, 0.05],
];

describe('parseRetentionRows', () => {
  it('parses, coerces, and sorts by ratio ascending', () => {
    const curve = parseRetentionRows([['0.5', '0.49'], ['0', '1.07'], ['0.1', '0.73']]);
    expect(curve.map((p) => p.ratio)).toEqual([0, 0.1, 0.5]);
    expect(curve[0].watchRatio).toBeCloseTo(1.07);
  });
  it('drops non-finite rows and tolerates empty input', () => {
    expect(parseRetentionRows([['x', 'y'], [0.1, 0.5]])).toHaveLength(1);
    expect(parseRetentionRows([])).toEqual([]);
    expect(parseRetentionRows(undefined as never)).toEqual([]);
  });
});

describe('watchRatioAtRatio', () => {
  const curve = parseRetentionRows(strongRows);
  it('returns null for an empty curve', () => {
    expect(watchRatioAtRatio([], 0.1)).toBeNull();
  });
  it('returns exact values at known points', () => {
    expect(watchRatioAtRatio(curve, 0.1)).toBeCloseTo(0.73);
    expect(watchRatioAtRatio(curve, 0.5)).toBeCloseTo(0.49);
  });
  it('linearly interpolates between points', () => {
    // midway between 0.05 (0.80) and 0.10 (0.73) -> 0.765
    expect(watchRatioAtRatio(curve, 0.075)).toBeCloseTo(0.765, 3);
  });
  it('clamps below first and above last point', () => {
    expect(watchRatioAtRatio(curve, -1)).toBeCloseTo(1.07);
    expect(watchRatioAtRatio(curve, 5)).toBeCloseTo(0.36);
  });
});

describe('holdAtSeconds', () => {
  const curve = parseRetentionRows(strongRows);
  it('maps seconds to a ratio via duration', () => {
    // 15s into a 300s video = 5% -> 0.80
    expect(holdAtSeconds(curve, 300, 15)).toBeCloseTo(0.8);
  });
  it('returns null for unknown/zero duration', () => {
    expect(holdAtSeconds(curve, 0, 15)).toBeNull();
    expect(holdAtSeconds([], 300, 15)).toBeNull();
  });
});

describe('summarizeCurve', () => {
  it('includes seconds-based holds only when a duration is given', () => {
    const curve = parseRetentionRows(strongRows);
    const withDur = summarizeCurve(curve, 300);
    expect(withDur.hold10pct).toBeCloseTo(0.73);
    expect(withDur.hold15s).toBeCloseTo(0.8); // 15/300 = 5%
    const noDur = summarizeCurve(curve);
    expect(noDur.hold10pct).toBeCloseTo(0.73);
    expect(noDur.hold15s).toBeNull();
  });
});

describe('classifyHook', () => {
  it('classifies against a benchmark (ratio of holds)', () => {
    expect(classifyHook(0.72, 0.73)).toBe('strong'); // ~0.99
    expect(classifyHook(0.55, 0.73)).toBe('average'); // ~0.75
    expect(classifyHook(0.4, 0.73)).toBe('weak'); // ~0.55
  });
  it('falls back to absolute thresholds with no benchmark', () => {
    expect(classifyHook(0.7, null)).toBe('strong');
    expect(classifyHook(0.5, null)).toBe('average');
    expect(classifyHook(0.3, null)).toBe('weak');
  });
  it('returns unknown when the hold is null', () => {
    expect(classifyHook(null, 0.7)).toBe('unknown');
  });
});

describe('analyzeRetention', () => {
  it('anchors the verdict on the 10% checkpoint vs benchmark', () => {
    const weak = parseRetentionRows(weakRows);
    const strong = parseRetentionRows(strongRows);
    const a = analyzeRetention(weak, { durationSeconds: 300, benchmarkCurve: strong });
    expect(a.checkpoint).toBe(VERDICT_CHECKPOINT);
    expect(a.holdAtCheckpoint).toBeCloseTo(0.4);
    expect(a.benchmarkHoldAtCheckpoint).toBeCloseTo(0.73);
    expect(a.verdict).toBe('weak'); // 0.40/0.73 ≈ 0.55
  });
  it('a template-grade video reads strong against itself', () => {
    const strong: RetentionCurve = parseRetentionRows(strongRows);
    const a = analyzeRetention(strong, { benchmarkCurve: strong });
    expect(a.verdict).toBe('strong');
  });
  it('handles an empty curve as unknown', () => {
    expect(analyzeRetention([]).verdict).toBe('unknown');
  });
});
