import {
  shouldRenderWaveform,
  binPeaks,
  normaliseLoop,
  ratioToTime,
  shouldLoopBack,
  formatTime,
  MAX_WAVEFORM_BYTES,
  MIN_LOOP_SECONDS,
} from '@/lib/waveform';

describe('shouldRenderWaveform — the cost guard', () => {
  it('allows an ordinary song', () => {
    // ~7 min, 48k stereo 24-bit ≈ 120 MB.
    expect(shouldRenderWaveform(120 * 1024 * 1024)).toBe(true);
  });

  it('refuses a file large enough to lock the tab', () => {
    expect(shouldRenderWaveform(MAX_WAVEFORM_BYTES + 1)).toBe(false);
  });

  it('refuses an unknown or empty size rather than trying', () => {
    expect(shouldRenderWaveform(null)).toBe(false);
    expect(shouldRenderWaveform(undefined)).toBe(false);
    expect(shouldRenderWaveform(0)).toBe(false);
    expect(shouldRenderWaveform(Number.NaN)).toBe(false);
  });
});

describe('binPeaks', () => {
  it('returns exactly the requested number of bins', () => {
    expect(binPeaks(new Array(1000).fill(0.5), 40)).toHaveLength(40);
  });

  it('takes the PEAK of each bin, not the average', () => {
    // Averaging a mastered track yields a featureless sausage; peaks keep the
    // transients that make a section recognisable.
    const samples = [0, 0, 0, 1, 0, 0, 0, 0];
    expect(binPeaks(samples, 2)[0]).toBe(1);
  });

  it('uses absolute value, so negative half-cycles count', () => {
    expect(binPeaks([-0.8, 0.1], 1)[0]).toBeCloseTo(0.8, 6);
  });

  it('clamps above full scale', () => {
    expect(binPeaks([1.7], 1)[0]).toBe(1);
  });

  it('covers the final samples — the last bin runs to the end', () => {
    const s = new Array(10).fill(0);
    s[9] = 1;
    expect(binPeaks(s, 3)[2]).toBe(1);
  });

  it('returns zeros for an empty input rather than an empty array', () => {
    expect(binPeaks([], 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('survives a silly bin count', () => {
    expect(binPeaks([1, 2, 3], 0)).toHaveLength(1);
  });

  it('ignores non-finite samples', () => {
    expect(binPeaks([Number.NaN, 0.4], 1)[0]).toBeCloseTo(0.4, 6);
  });
});

describe('normaliseLoop', () => {
  it('orders a backwards drag', () => {
    expect(normaliseLoop(30, 10, 100)).toEqual({ start: 10, end: 30 });
  });

  it('clamps to the track', () => {
    expect(normaliseLoop(-5, 500, 100)).toEqual({ start: 0, end: 100 });
  });

  it('returns null for a drag too short to be a phrase', () => {
    expect(normaliseLoop(10, 10 + MIN_LOOP_SECONDS / 2, 100)).toBeNull();
  });

  it('returns null rather than a zero-length region for a click', () => {
    expect(normaliseLoop(10, 10, 100)).toBeNull();
  });

  it('returns null for a track of unknown length', () => {
    expect(normaliseLoop(1, 5, 0)).toBeNull();
    expect(normaliseLoop(1, 5, Number.NaN)).toBeNull();
  });
});

describe('ratioToTime', () => {
  it('maps the ends of the waveform to the ends of the track', () => {
    expect(ratioToTime(0, 200)).toBe(0);
    expect(ratioToTime(1, 200)).toBe(200);
  });

  it('clamps a pointer dragged outside', () => {
    expect(ratioToTime(-1, 200)).toBe(0);
    expect(ratioToTime(2, 200)).toBe(200);
  });

  it('is 0 for an unknown duration', () => {
    expect(ratioToTime(0.5, 0)).toBe(0);
  });
});

describe('shouldLoopBack', () => {
  const loop = { start: 10, end: 20 };

  it('is false mid-loop', () => {
    expect(shouldLoopBack(15, loop)).toBe(false);
  });

  it('is true at the loop end', () => {
    expect(shouldLoopBack(20, loop)).toBe(true);
  });

  it('is true when seeking BEFORE the loop — otherwise the loop silently stops applying', () => {
    expect(shouldLoopBack(2, loop)).toBe(true);
  });

  it('tolerates a small backwards jitter without fighting the playhead', () => {
    expect(shouldLoopBack(9.98, loop)).toBe(false);
  });

  it('is false when no loop is set', () => {
    expect(shouldLoopBack(15, null)).toBe(false);
  });
});

describe('formatTime', () => {
  it('formats minutes and seconds', () => {
    expect(formatTime(83)).toBe('1:23');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(455)).toBe('7:35');
  });

  it('shows a dash for unknown', () => {
    expect(formatTime(Number.NaN)).toBe('—');
    expect(formatTime(-1)).toBe('—');
  });
});
