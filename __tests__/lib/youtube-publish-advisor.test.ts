/** @jest-environment node */
/**
 * Tests for src/lib/youtube-publish-advisor.ts. Verdicts, the next-Friday date
 * math, and the confidence arithmetic are checked against hand-computed values,
 * not the code's own output — so a regression in the decision tree fails here.
 */

import {
  advisePublish,
  buildPublishAdvice,
  nextFriday,
  weightedRetention,
  DEFAULT_BASELINE_VPD,
  type AdvisorInput,
} from '@/lib/youtube-publish-advisor';

const WED = '2026-07-15'; // a Wednesday → next Friday is 2026-07-17

function input(overrides: Partial<AdvisorInput> = {}): AdvisorInput {
  return {
    asOf: WED,
    recentViewsPerDay: 10000,
    viewsDeclining: false,
    topRetention: 50,
    netSubsPerDay: 25,
    subsToTier2: 72,
    daysSinceLastUpload: 10,
    ...overrides,
  };
}

describe('nextFriday', () => {
  it('advances a weekday to the coming Friday', () => {
    expect(nextFriday('2026-07-13')).toBe('2026-07-17'); // Mon → Fri
    expect(nextFriday('2026-07-15')).toBe('2026-07-17'); // Wed → Fri
  });
  it('returns the same date when it is already Friday', () => {
    expect(nextFriday('2026-07-17')).toBe('2026-07-17');
  });
  it('wraps to next week from Saturday', () => {
    expect(nextFriday('2026-07-18')).toBe('2026-07-24'); // Sat → next Fri
  });
  it('guards an unparseable date', () => {
    expect(nextFriday('nope')).toBe('nope');
  });
});

describe('weightedRetention', () => {
  it('weights by views so the most-watched songs dominate', () => {
    // (50*1000 + 30*3000) / 4000 = 35
    expect(weightedRetention([{ retentionPct: 50, views: 1000 }, { retentionPct: 30, views: 3000 }])).toBeCloseTo(35, 6);
  });
  it('null when there is nothing positive to weight', () => {
    expect(weightedRetention([])).toBeNull();
    expect(weightedRetention([{ retentionPct: 40, views: 0 }])).toBeNull();
  });
  it('skips non-finite / zero-view rows', () => {
    expect(weightedRetention([
      { retentionPct: 40, views: 100 },
      { retentionPct: NaN, views: 100 },
      { retentionPct: 90, views: 0 },
    ])).toBeCloseTo(40, 6);
  });
});

describe('advisePublish — verdicts', () => {
  it('ship-now: reach draining + retention healthy → hero upload, Friday, high confidence', () => {
    const a = advisePublish(input({ recentViewsPerDay: 6000, viewsDeclining: true, topRetention: 45 }));
    expect(a.verdict).toBe('ship-now');
    expect(a.recommendedDate).toBe('2026-07-17');
    expect(a.slotLabel).toMatch(/Friday.*Toronto/);
    // 55 +15 near +15 declining +5 strong-retention +5 subs = 95
    expect(a.confidence).toBe(95);
    expect(a.reasons.some((r) => /trending down/i.test(r))).toBe(true);
    expect(a.reasons.some((r) => /retention is healthy/i.test(r))).toBe(true);
    expect(a.reasons.some((r) => /Tier-2/.test(r))).toBe(true);
    expect(a.reasons.some((r) => /WhatsApp/.test(r))).toBe(true);
  });

  it('on-schedule: everything calm → publish Friday on cadence', () => {
    const a = advisePublish(input()); // views high, not declining, retention 50
    expect(a.verdict).toBe('on-schedule');
    expect(a.recommendedDate).toBe('2026-07-17');
    // 65 +10 healthy +10 subs +5 not-draining = 90
    expect(a.confidence).toBe(90);
    expect(a.signals.reachDraining).toBe(false);
  });

  it('let-it-ride: just published → hold even if reach is draining', () => {
    const a = advisePublish(input({ daysSinceLastUpload: 1, recentViewsPerDay: 6000, viewsDeclining: true, topRetention: 45 }));
    expect(a.verdict).toBe('let-it-ride');
    expect(a.recommendedDate).toBe('2026-07-17'); // next drop still Friday
    expect(a.confidence).toBe(75); // 70 + 5 subs
    expect(a.reasons.some((r) => /published 1d ago/i.test(r))).toBe(true);
  });

  it('hold-fix-content: retention FALLING → fix content first, no slot', () => {
    const a = advisePublish(input({ topRetention: 40, priorTopRetention: 50, viewsDeclining: true }));
    expect(a.verdict).toBe('hold-fix-content');
    expect(a.recommendedDate).toBeNull();
    expect(a.slotLabel).toBeNull();
    expect(a.confidence).toBe(80); // 60 + round(0.2*100)
    expect(a.reasons.some((r) => /retention fell/i.test(r))).toBe(true);
    expect(a.reasons.some((r) => /Friday publish/.test(r))).toBe(false); // no timing reason when holding
  });

  it('hold-fix-content: low retention + draining (no prior) → fix content', () => {
    const a = advisePublish(input({ topRetention: 30, priorTopRetention: null, viewsDeclining: true }));
    expect(a.verdict).toBe('hold-fix-content');
    expect(a.confidence).toBe(70); // 60 + round(40-30)
    expect(a.reasons.some((r) => /retention is low/i.test(r))).toBe(true);
  });

  it('ship-now with UNKNOWN retention is docked confidence + flagged', () => {
    const a = advisePublish(input({ recentViewsPerDay: 6000, viewsDeclining: true, topRetention: null, subsToTier2: null }));
    expect(a.verdict).toBe('ship-now'); // unknown retention treated as healthy for the verdict
    // 55 +15 near +15 declining +5 subs −10 unknown = 80
    expect(a.confidence).toBe(80);
    expect(a.reasons.some((r) => /retention data was unavailable/i.test(r))).toBe(true);
  });

  it('labels the slot "Today" when asOf is a Friday', () => {
    const a = advisePublish(input({ asOf: '2026-07-17', recentViewsPerDay: 6000, viewsDeclining: true, topRetention: 45 }));
    expect(a.recommendedDate).toBe('2026-07-17');
    expect(a.slotLabel).toMatch(/Today \(Friday\)/);
    expect(a.headline).toMatch(/today \(Fri\)/i);
  });

  it('confidence is clamped to [40,95]', () => {
    // Everything firing for ship-now would exceed 95 → clamped
    const a = advisePublish(
      input({ recentViewsPerDay: 6000, viewsDeclining: true, suggestedDropPct: 0.6, topRetention: 60 })
    );
    expect(a.confidence).toBe(95);
    expect(a.signals.reachDraining).toBe(true);
  });

  it('uses a custom baseline when provided', () => {
    // recentViewsPerDay 6000 is ABOVE a 4000 baseline*1.1(4400) and not declining → not draining
    const a = advisePublish(input({ recentViewsPerDay: 6000, baselineViewsPerDay: 4000, topRetention: 50 }));
    expect(a.signals.reachDraining).toBe(false);
    expect(a.verdict).toBe('on-schedule');
  });

  it('exposes the default baseline constant', () => {
    expect(DEFAULT_BASELINE_VPD).toBe(5000);
  });
});

describe('buildPublishAdvice (shared route + page derivation)', () => {
  // 20-day series; finalized = first 19, recent window = last 7 finalized.
  function dailySeries({ recentViews, priorViews, subs = 20 }: { recentViews: number; priorViews: number; subs?: number }) {
    const days = 20;
    return Array.from({ length: days }, (_, i) => {
      const d = new Date('2026-06-01T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + i);
      const views = i === days - 1 ? 0 : i >= days - 1 - 7 ? recentViews : priorViews;
      return { date: d.toISOString().slice(0, 10), views, subscribersGained: subs };
    });
  }
  const vid = (id: string, publishedAt: string, durationSeconds: number) => ({
    id, publishedAt, duration: `PT${durationSeconds}S`, durationSeconds,
  });

  it('ship-now: draining series + healthy long-form retention', () => {
    const b = buildPublishAdvice({
      asOf: '2026-07-15',
      series: dailySeries({ recentViews: 6000, priorViews: 12000 }),
      channel: { subscriberCount: 928 },
      videos: [vid('lf', '2020-01-01T00:00:00Z', 240)],
      videoAnalytics: [{ videoId: 'lf', views: 1000, averageViewDuration: 120 }], // 50%
    });
    expect(b.advice.verdict).toBe('ship-now');
    expect(b.inputs.viewsDeclining).toBe(true);
    expect(b.inputs.recentViewsPerDay).toBe(6000);
    expect(b.inputs.longFormRetention).toBeCloseTo(50, 5);
    expect(b.inputs.subsToTier2).toBe(72);
    expect(b.advice.recommendedDate).toBe('2026-07-17');
  });

  it('excludes Shorts from BOTH retention and recency', () => {
    const b = buildPublishAdvice({
      asOf: '2026-07-15',
      series: dailySeries({ recentViews: 6000, priorViews: 12000 }),
      channel: { subscriberCount: 928 },
      videos: [vid('lf', '2020-01-01T00:00:00Z', 240), vid('sh', '2026-07-14T00:00:00Z', 30)],
      videoAnalytics: [
        { videoId: 'lf', views: 5000, averageViewDuration: 72 }, // 30% (weak)
        { videoId: 'sh', views: 1000, averageViewDuration: 28 }, // 93% but EXCLUDED
      ],
    });
    expect(b.inputs.longFormRetention).toBeCloseTo(30, 5); // Short's 93% not blended
    expect(b.inputs.daysSinceLastUpload).toBeGreaterThan(2); // recent Short ignored for recency
    expect(b.advice.verdict).toBe('hold-fix-content'); // draining + weak long-form retention
  });

  it('retention omitted when per-video analytics is null', () => {
    const b = buildPublishAdvice({
      asOf: '2026-07-15',
      series: dailySeries({ recentViews: 12000, priorViews: 12000 }),
      channel: { subscriberCount: 928 },
      videos: [vid('lf', '2020-01-01T00:00:00Z', 240)],
      videoAnalytics: null,
    });
    expect(b.inputs.longFormRetention).toBeNull();
  });

  it('flags the Data-API-unavailable caveat when channel + catalogue are absent', () => {
    const b = buildPublishAdvice({
      asOf: '2026-07-15',
      series: dailySeries({ recentViews: 12000, priorViews: 12000 }),
      channel: null,
      videos: [],
      videoAnalytics: null,
    });
    expect(b.inputs.subsToTier2).toBeNull();
    expect(b.inputs.daysSinceLastUpload).toBeNull();
    expect(b.caveats.some((c) => /Data API unavailable/.test(c))).toBe(true);
  });
});
