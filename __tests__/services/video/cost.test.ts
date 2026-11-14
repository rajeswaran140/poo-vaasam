import {
  estimateCostUsd,
  draftCostUsd,
  DRAFT_ESTIMATE_USD,
  DEFAULT_BUDGET_USD_CAP,
  RATE_CARDS,
  SONNET_USD_PER_MTOK,
  GROK_RATES_VERIFIED_AT,
  grokVideoCostUsd,
  grokVideoResolution,
  usdFromXaiTicks,
} from '@/services/video/cost';

describe('estimateCostUsd', () => {
  it('prices a Grok still at a flat per-image rate, ignoring duration', () => {
    expect(estimateCostUsd('grok', 'STILL', 8)).toBeCloseTo(0.02, 10);
    expect(estimateCostUsd('grok', 'STILL', 1)).toBeCloseTo(0.02, 10);
  });

  it('without the shot, prices a clip at the 1080p ceiling ($0.25/s), never the old $0.08', () => {
    expect(estimateCostUsd('grok', 'HERO', 15)).toBeCloseTo(3.75, 10);
    expect(estimateCostUsd('grok', 'MOTION', 5)).toBeCloseTo(1.25, 10);
  });

  it('is free for the fake provider', () => {
    expect(estimateCostUsd('fake', 'HERO', 10)).toBe(0);
  });

  it('throws for an unknown provider', () => {
    expect(() => estimateCostUsd('nope', 'STILL', 1)).toThrow(/unknown provider/i);
  });
});

describe('draftCostUsd', () => {
  it('prices Sonnet input and output tokens per million', () => {
    expect(draftCostUsd(2000, 1500)).toBeCloseTo(0.0285, 10);
  });
});

describe('cost constants', () => {
  it('exposes the rate card, draft estimate and budget cap', () => {
    expect(RATE_CARDS.grok.STILL).toEqual({ flatUsd: 0.02, perSecondUsd: 0 });
    expect(RATE_CARDS.grok.MOTION).toEqual({ flatUsd: 0, perSecondUsd: 0.25 });
    expect(RATE_CARDS.grok.HERO).toEqual({ flatUsd: 0, perSecondUsd: 0.25 });
    expect(DRAFT_ESTIMATE_USD).toBe(0.15);
    expect(SONNET_USD_PER_MTOK).toEqual({ input: 3, output: 15 });
    expect(DEFAULT_BUDGET_USD_CAP).toBe(40);
    expect(GROK_RATES_VERIFIED_AT).toBeNull();
  });
});

describe('draftMaxOutputTokens (scales with the window, under the SDK\'s non-streaming ceiling)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { draftMaxOutputTokens } = require('@/services/video/cost');

  it('keeps 6000 for a short window and grows with a long one', () => {
    expect(draftMaxOutputTokens(30)).toBe(6000);
    expect(draftMaxOutputTokens(120)).toBe(6000);
    expect(draftMaxOutputTokens(300)).toBe(14400);
    expect(draftMaxOutputTokens(400)).toBe(19200);
    expect(draftMaxOutputTokens(420)).toBe(20000);
  });

  it('never exceeds 20000: past ~21333 the SDK refuses a non-streaming call', () => {
    expect(draftMaxOutputTokens(10_000)).toBe(20000);
  });
});

describe('draftReserveUsd (M1: bounded by the lyrics length and the window)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { draftReserveUsd, draftLabelUsd, draftCostUsd: cost, DRAFT_ESTIMATE_USD: est } = require('@/services/video/cost');

  it('is the token cost of ceil(len/2)+1500 input and the window\'s output ceiling', () => {
    expect(draftReserveUsd('x'.repeat(1001), 30)).toBeCloseTo(cost(501 + 1500, 6000), 10);
    expect(draftReserveUsd('', 30)).toBeCloseTo(cost(1500, 6000), 10);
    expect(draftReserveUsd('', 420)).toBeCloseTo(cost(1500, 20000), 10);
  });

  it('stays below the flat estimate for a short window even at the 8000-character maximum', () => {
    expect(draftReserveUsd('x'.repeat(8000), 30)).toBeCloseTo(cost(5500, 6000), 10);
    expect(draftReserveUsd('x'.repeat(8000), 30)).toBeLessThan(est);
  });

  it('the UI label shows the flat estimate when it covers the bound, else the bound', () => {
    expect(draftLabelUsd('x'.repeat(8000), 30)).toBe(est);
    expect(draftLabelUsd('x'.repeat(8000), 30, 0.01)).toBeCloseTo(cost(5500, 6000), 10);
    // A seven-minute window reserves more than the flat estimate, and says so.
    expect(draftLabelUsd('x'.repeat(8000), 420)).toBeCloseTo(cost(5500, 20000), 10);
  });
});

describe('grokVideoCostUsd (measured from xAI usage on real clips, 2026-11-10 to 11-13)', () => {
  it('matches each real charge to the cent', () => {
    // 1080p (no faces), first frame only
    expect(grokVideoCostUsd({ durationSec: 15, referenceCount: 0, hasFirstFrame: true })).toBeCloseTo(3.76, 6);
    expect(grokVideoCostUsd({ durationSec: 12, referenceCount: 0, hasFirstFrame: true })).toBeCloseTo(3.01, 6);
    // 720p (faces sent): 2 faces + first frame = 3 images; 3 faces + frame = 4
    expect(grokVideoCostUsd({ durationSec: 15, referenceCount: 2, hasFirstFrame: true })).toBeCloseTo(2.13, 6);
    expect(grokVideoCostUsd({ durationSec: 14, referenceCount: 3, hasFirstFrame: true })).toBeCloseTo(2.0, 6);
  });
  it('a clip with faces is 720p, without them 1080p (one rule for the request and the price)', () => {
    expect(grokVideoResolution(0)).toBe('1080p');
    expect(grokVideoResolution(1)).toBe('720p');
  });
});

describe('usdFromXaiTicks', () => {
  it('reads xAI\'s own charge (1e10 ticks = $1), or null when it is not a sane amount', () => {
    expect(usdFromXaiTicks(37_600_000_000)).toBeCloseTo(3.76, 6);
    expect(usdFromXaiTicks(0)).toBe(0);
    for (const bad of [undefined, null, -1, Number.NaN, '376', 2e12]) expect(usdFromXaiTicks(bad)).toBeNull();
  });
});

describe('720p for any clip (story setting, 2026-11-14)', () => {
  it('a story set to 720p makes every clip at 720p, faces or not', () => {
    expect(grokVideoResolution(0, '720p')).toBe('720p');
    expect(grokVideoResolution(0, '1080p')).toBe('1080p');
    expect(grokVideoResolution(2, '1080p')).toBe('720p');
  });
  it('prices a 720p clip without faces at $0.14/s + images (7 s + picture = $0.99)', () => {
    expect(grokVideoCostUsd({ durationSec: 7, referenceCount: 0, hasFirstFrame: true, quality: '720p' })).toBeCloseTo(0.99, 6);
    expect(grokVideoCostUsd({ durationSec: 7, referenceCount: 0, hasFirstFrame: true })).toBeCloseTo(1.76, 6);
  });
});
