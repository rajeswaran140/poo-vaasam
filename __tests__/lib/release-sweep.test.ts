import {
  parseIsoDuration,
  isShortDuration,
  costPerVideo,
  planSweep,
  isAutoCaption,
  SHORT_MAX_SECONDS,
  COST_CAPTIONS_LIST,
  MAX_SWEEP_UNITS,
} from '@/lib/release-sweep';

describe('parseIsoDuration', () => {
  it('reads the forms YouTube actually returns', () => {
    expect(parseIsoDuration('PT7M35S')).toBe(455);
    expect(parseIsoDuration('PT29S')).toBe(29);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('PT4M')).toBe(240);
  });

  it('handles fractional seconds without producing a fraction', () => {
    expect(parseIsoDuration('PT29.5S')).toBe(29);
  });

  it('returns 0 for junk rather than throwing — one bad video must not abort the sweep', () => {
    expect(parseIsoDuration('')).toBe(0);
    expect(parseIsoDuration(null)).toBe(0);
    expect(parseIsoDuration(undefined)).toBe(0);
    expect(parseIsoDuration('banana')).toBe(0);
    expect(parseIsoDuration('P1D')).toBe(0); // no T section: not a video duration
  });
});

describe('isShortDuration', () => {
  it('treats the boundary as inclusive', () => {
    expect(isShortDuration(SHORT_MAX_SECONDS)).toBe(true);
    expect(isShortDuration(SHORT_MAX_SECONDS + 1)).toBe(false);
  });

  it('does NOT call an unknown duration a Short', () => {
    // A 0 means the parse failed. Grading a full song against the Shorts rules
    // would report gaps that do not exist.
    expect(isShortDuration(0)).toBe(false);
    expect(isShortDuration(-5)).toBe(false);
  });

  it('classifies a real Short and a real song', () => {
    expect(isShortDuration(parseIsoDuration('PT29S'))).toBe(true);
    expect(isShortDuration(parseIsoDuration('PT7M35S'))).toBe(false);
  });
});

describe('costPerVideo — the arithmetic that burned a day of quota', () => {
  it('prices captions.list at 50, not 1', () => {
    expect(COST_CAPTIONS_LIST).toBe(50);
    // 1 videos.list + 50 captions.list + 3 playlist pages
    expect(costPerVideo(3)).toBe(54);
  });

  it('counts PAGES, not playlists — a 54-item playlist is two pages', () => {
    expect(costPerVideo(4) - costPerVideo(3)).toBe(1);
  });

  it('never goes negative or fractional on bad input', () => {
    expect(costPerVideo(-2)).toBe(51);
    expect(costPerVideo(Number.NaN)).toBe(51);
    expect(costPerVideo(2.7)).toBe(53);
  });
});

describe('planSweep — refusing is the safe direction', () => {
  it('allows an ordinary week', () => {
    const p = planSweep(11, 3);
    expect(p.estimatedUnits).toBe(594);
    expect(p.affordable).toBe(true);
  });

  it('refuses a sweep that would eat the day', () => {
    const p = planSweep(200, 3);
    expect(p.affordable).toBe(false);
    expect(p.estimatedUnits).toBeGreaterThan(MAX_SWEEP_UNITS);
  });

  it('reports how many videos WOULD fit, so the operator can retry usefully', () => {
    const p = planSweep(200, 3);
    expect(p.maxAffordableVideos).toBe(Math.floor(MAX_SWEEP_UNITS / 54));
    expect(planSweep(p.maxAffordableVideos, 3).affordable).toBe(true);
    expect(planSweep(p.maxAffordableVideos + 1, 3).affordable).toBe(false);
  });

  it('treats an exactly-at-cap sweep as affordable', () => {
    const per = costPerVideo(3);
    const n = Math.floor(MAX_SWEEP_UNITS / per);
    expect(planSweep(n, 3, n * per).affordable).toBe(true);
  });

  it('is a no-op for zero videos', () => {
    const p = planSweep(0, 3);
    expect(p.estimatedUnits).toBe(0);
    expect(p.affordable).toBe(true);
  });

  it('stays under the cap by DEFAULT, well below the daily budget', () => {
    // The snapshot cron and ad-hoc work share the same 10,000.
    expect(MAX_SWEEP_UNITS).toBeLessThan(10_000 / 2);
  });
});

describe('isAutoCaption', () => {
  it('identifies the track kind YouTube regenerates', () => {
    expect(isAutoCaption({ trackKind: 'asr' })).toBe(true);
  });

  it('leaves an uploaded lyrics track alone', () => {
    expect(isAutoCaption({ trackKind: 'standard' })).toBe(false);
    expect(isAutoCaption({})).toBe(false);
  });
});
