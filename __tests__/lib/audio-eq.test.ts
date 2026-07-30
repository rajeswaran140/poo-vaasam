import {
  EQ_BANDS,
  EQ_PRESETS,
  EQ_MAX_GAIN_DB,
  EQ_MIN_GAIN_DB,
  flatGains,
  clampGain,
  isFlat,
  activeBands,
  describeEq,
} from '@/lib/audio-eq';

describe('bands', () => {
  it('ascend in frequency, so the controls read left-to-right as low-to-high', () => {
    const f = EQ_BANDS.map((b) => b.frequency);
    expect([...f].sort((a, b) => a - b)).toEqual(f);
  });

  it('has unique ids — they key both React and the filter graph', () => {
    expect(new Set(EQ_BANDS.map((b) => b.id)).size).toBe(EQ_BANDS.length);
  });

  it('spans the audible range that matters for a vocal master', () => {
    expect(EQ_BANDS[0].frequency).toBeLessThanOrEqual(100);
    expect(EQ_BANDS[EQ_BANDS.length - 1].frequency).toBeGreaterThanOrEqual(10000);
  });
});

describe('flatGains', () => {
  it('is the default, and it is genuinely flat', () => {
    expect(isFlat(flatGains())).toBe(true);
  });

  it('covers every band, so no filter is left undefined', () => {
    const g = flatGains();
    for (const b of EQ_BANDS) expect(g[b.id]).toBe(0);
  });
});

describe('clampGain', () => {
  it('holds the usable range', () => {
    expect(clampGain(99)).toBe(EQ_MAX_GAIN_DB);
    expect(clampGain(-99)).toBe(EQ_MIN_GAIN_DB);
    expect(clampGain(3)).toBe(3);
  });

  it('turns nonsense into 0 — NOT into max gain', () => {
    // Deliberate: a NaN or Infinity that slipped through should mean "leave it
    // alone", never "+12 dB". Clamping non-finite input to the maximum would
    // turn a bug into a sudden loud boost in the operator's headphones.
    expect(clampGain(Number.NaN)).toBe(0);
    expect(clampGain(Infinity)).toBe(0);
    expect(clampGain(-Infinity)).toBe(0);
  });
});

describe('isFlat — the guard on the "you are not hearing the master" warning', () => {
  it('is false for even a small nudge; the warning must not be suppressible by subtlety', () => {
    expect(isFlat({ ...flatGains(), mid: 0.4 })).toBe(false);
  });

  it('is false for a cut as well as a boost', () => {
    expect(isFlat({ ...flatGains(), low: -1 })).toBe(false);
  });

  it('treats a missing band as 0 rather than throwing', () => {
    expect(isFlat({})).toBe(true);
  });
});

describe('activeBands / describeEq', () => {
  it('names only the bands actually doing something', () => {
    const g = { ...flatGains(), low: 3, high: -2 };
    expect(activeBands(g).map((b) => b.id)).toEqual(['low', 'high']);
  });

  it('reads as plain language with signed values', () => {
    const d = describeEq({ ...flatGains(), low: 3, high: -2 });
    expect(d).toContain('Low 60 Hz +3 dB');
    expect(d).toContain('High 12 kHz −2 dB');
  });

  it('is empty when flat, so the warning line renders nothing', () => {
    expect(describeEq(flatGains())).toBe('');
  });

  it('clamps in the description too, so the text cannot claim +99 dB', () => {
    expect(describeEq({ ...flatGains(), mid: 99 })).toContain(`+${EQ_MAX_GAIN_DB} dB`);
  });
});

describe('presets', () => {
  it('starts with Flat, so the honest option is the first one', () => {
    expect(EQ_PRESETS[0].id).toBe('flat');
    expect(isFlat(EQ_PRESETS[0].gains)).toBe(true);
  });

  it('every preset covers every band', () => {
    for (const p of EQ_PRESETS) {
      for (const b of EQ_BANDS) expect(typeof p.gains[b.id]).toBe('number');
    }
  });

  it('no preset exceeds the usable range', () => {
    for (const p of EQ_PRESETS) {
      for (const b of EQ_BANDS) {
        expect(p.gains[b.id]).toBeGreaterThanOrEqual(EQ_MIN_GAIN_DB);
        expect(p.gains[b.id]).toBeLessThanOrEqual(EQ_MAX_GAIN_DB);
      }
    }
  });

  it('every non-flat preset is detected as NOT flat, so each one warns', () => {
    for (const p of EQ_PRESETS.filter((x) => x.id !== 'flat')) {
      expect(isFlat(p.gains)).toBe(false);
    }
  });

  it('each preset explains what it is checking, not what genre it suits', () => {
    for (const p of EQ_PRESETS) expect(p.hint.length).toBeGreaterThan(0);
  });
});
