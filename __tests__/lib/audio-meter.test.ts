import {
  toDb,
  measureBlock,
  barFraction,
  decayPeak,
  METER_FLOOR_DB,
  TRUE_PEAK_CEILING_DB,
} from '@/lib/audio-meter';

describe('toDb', () => {
  it('maps full scale to 0 dBFS', () => {
    expect(toDb(1)).toBeCloseTo(0, 6);
  });

  it('maps half amplitude to about -6 dBFS', () => {
    expect(toDb(0.5)).toBeCloseTo(-6.02, 1);
  });

  it('returns the floor for silence, NOT -Infinity', () => {
    // -Infinity would break every bar-width calculation downstream.
    expect(toDb(0)).toBe(METER_FLOOR_DB);
    expect(Number.isFinite(toDb(0))).toBe(true);
  });

  it('clamps anything below the floor', () => {
    expect(toDb(0.0000001)).toBe(METER_FLOOR_DB);
  });

  it('survives nonsense input', () => {
    expect(toDb(Number.NaN)).toBe(METER_FLOOR_DB);
    expect(toDb(-1)).toBe(METER_FLOOR_DB);
  });
});

describe('measureBlock', () => {
  it('reports peak from the largest absolute sample, including negatives', () => {
    expect(measureBlock([0.1, -0.9, 0.2]).peakDb).toBeCloseTo(toDb(0.9), 6);
  });

  it('rms tracks level, and sits below peak for a non-constant signal', () => {
    const r = measureBlock([1, 0, 1, 0]);
    expect(r.rmsDb).toBeLessThan(r.peakDb);
  });

  it('flags a block that exceeds the -1 dBTP delivery ceiling', () => {
    // ~-0.5 dBFS
    expect(measureBlock([0.945]).overCeiling).toBe(true);
  });

  it('does NOT flag a well-behaved master at -14', () => {
    expect(measureBlock([0.2, -0.2]).overCeiling).toBe(false);
    expect(TRUE_PEAK_CEILING_DB).toBe(-1);
  });

  it('separates clipping from merely hot', () => {
    expect(measureBlock([0.99]).clipped).toBe(false);
    expect(measureBlock([1]).clipped).toBe(true);
    // Float samples can exceed full scale after processing.
    expect(measureBlock([1.4]).clipped).toBe(true);
  });

  it('treats an empty block as silence rather than dividing by zero', () => {
    const r = measureBlock([]);
    expect(r.peakDb).toBe(METER_FLOOR_DB);
    expect(Number.isFinite(r.rmsDb)).toBe(true);
  });

  it('ignores non-finite samples instead of poisoning the result', () => {
    const r = measureBlock([Number.NaN, 0.5, Infinity]);
    expect(Number.isFinite(r.peakDb)).toBe(true);
    expect(Number.isFinite(r.rmsDb)).toBe(true);
  });
});

describe('barFraction — linear in dB, not in amplitude', () => {
  it('puts 0 dBFS at the top and the floor at the bottom', () => {
    expect(barFraction(0)).toBe(1);
    expect(barFraction(METER_FLOOR_DB)).toBe(0);
  });

  it('places a -14 LUFS-ish master in the upper half, not squashed at the bottom', () => {
    // An amplitude-linear meter would put -14 dB at ~0.2 of the bar and make
    // every master look identical. This is the reason for the dB mapping.
    expect(barFraction(-14)).toBeGreaterThan(0.5);
  });

  it('clamps out-of-range values', () => {
    expect(barFraction(20)).toBe(1);
    expect(barFraction(-200)).toBe(0);
    expect(barFraction(Number.NaN)).toBe(0);
  });
});

describe('decayPeak — why a meter is readable at all', () => {
  it('jumps instantly to a higher peak', () => {
    expect(decayPeak(-20, -3)).toBe(-3);
  });

  it('eases down rather than dropping, so a transient stays visible', () => {
    expect(decayPeak(-3, -30, 0.8)).toBeCloseTo(-3.8, 6);
  });

  it('never falls below the current level', () => {
    expect(decayPeak(-3, -3.2, 5)).toBe(-3.2);
  });
});
