import {
  estimateCostUsd,
  draftCostUsd,
  DRAFT_ESTIMATE_USD,
  DEFAULT_BUDGET_USD_CAP,
  RATE_CARDS,
  SONNET_USD_PER_MTOK,
  GROK_RATES_VERIFIED_AT,
} from '@/services/video/cost';

describe('estimateCostUsd', () => {
  it('prices a Grok still at a flat per-image rate, ignoring duration', () => {
    expect(estimateCostUsd('grok', 'STILL', 8)).toBeCloseTo(0.02, 10);
    expect(estimateCostUsd('grok', 'STILL', 1)).toBeCloseTo(0.02, 10);
  });

  it('prices Grok motion per second (lite model)', () => {
    expect(estimateCostUsd('grok', 'MOTION', 5)).toBeCloseTo(0.1, 10);
  });

  it('prices Grok hero per second (full model)', () => {
    expect(estimateCostUsd('grok', 'HERO', 15)).toBeCloseTo(1.2, 10);
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
    expect(RATE_CARDS.grok.MOTION).toEqual({ flatUsd: 0, perSecondUsd: 0.02 });
    expect(RATE_CARDS.grok.HERO).toEqual({ flatUsd: 0, perSecondUsd: 0.08 });
    expect(DRAFT_ESTIMATE_USD).toBe(0.15);
    expect(SONNET_USD_PER_MTOK).toEqual({ input: 3, output: 15 });
    expect(DEFAULT_BUDGET_USD_CAP).toBe(40);
    expect(GROK_RATES_VERIFIED_AT).toBeNull();
  });
});

describe('draftReserveUsd (M1: bounded by the lyrics length)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { draftReserveUsd, draftLabelUsd, draftCostUsd: cost, DRAFT_ESTIMATE_USD: est } = require('@/services/video/cost');

  it('is the token cost of ceil(len/2)+1500 input and the 6000-token output ceiling', () => {
    expect(draftReserveUsd('x'.repeat(1001))).toBeCloseTo(cost(501 + 1500, 6000), 10);
    expect(draftReserveUsd('')).toBeCloseTo(cost(1500, 6000), 10);
  });

  it('stays below the flat estimate even at the 8000-character maximum', () => {
    expect(draftReserveUsd('x'.repeat(8000))).toBeCloseTo(cost(5500, 6000), 10);
    expect(draftReserveUsd('x'.repeat(8000))).toBeLessThan(est);
  });

  it('the UI label shows the flat estimate when it covers the bound, else the bound', () => {
    expect(draftLabelUsd('x'.repeat(8000))).toBe(est);
    expect(draftLabelUsd('x'.repeat(8000), 0.01)).toBeCloseTo(cost(5500, 6000), 10);
  });
});
