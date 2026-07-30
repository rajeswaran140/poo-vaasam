import {
  PLAYBACK_RATES,
  DEFAULT_RATE,
  clampRate,
  formatRate,
  isDetailRate,
  realTimeFor,
} from '@/lib/playback-rate';

describe('PLAYBACK_RATES', () => {
  it('includes 1x, and it is the default', () => {
    expect(PLAYBACK_RATES).toContain(1);
    expect(DEFAULT_RATE).toBe(1);
  });

  it('ascends, so the control reads slow-to-fast', () => {
    const r = [...PLAYBACK_RATES];
    expect([...r].sort((a, b) => a - b)).toEqual(r);
  });

  it('offers 0.75x — the rate at which sung Tamil consonants become audible', () => {
    expect(PLAYBACK_RATES).toContain(0.75);
  });
});

describe('clampRate', () => {
  it('holds the supported range', () => {
    expect(clampRate(9)).toBe(PLAYBACK_RATES[PLAYBACK_RATES.length - 1]);
    expect(clampRate(0.01)).toBe(PLAYBACK_RATES[0]);
  });

  it('falls back to normal speed for nonsense rather than silence', () => {
    expect(clampRate(0)).toBe(DEFAULT_RATE);
    expect(clampRate(-1)).toBe(DEFAULT_RATE);
    expect(clampRate(Number.NaN)).toBe(DEFAULT_RATE);
  });
});

describe('formatRate', () => {
  it('reads plainly at normal speed', () => {
    expect(formatRate(1)).toBe('1×');
  });

  it('keeps the fraction for slow rates', () => {
    expect(formatRate(0.75)).toBe('0.75×');
  });
});

describe('isDetailRate — when to surface the pitch warning', () => {
  it('is true below normal speed', () => {
    expect(isDetailRate(0.75)).toBe(true);
  });

  it('is false at or above normal, so the warning is not always on', () => {
    expect(isDetailRate(1)).toBe(false);
    expect(isDetailRate(1.5)).toBe(false);
  });
});

describe('realTimeFor', () => {
  it('a passage takes longer at a slower rate', () => {
    expect(realTimeFor(60, 0.5)).toBe(120);
  });

  it('is unchanged at 1x', () => {
    expect(realTimeFor(60, 1)).toBe(60);
  });

  it('handles nonsense input', () => {
    expect(realTimeFor(Number.NaN, 1)).toBe(0);
    expect(realTimeFor(-5, 1)).toBe(0);
  });
});
