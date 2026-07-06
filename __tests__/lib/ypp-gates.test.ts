import { TIER1, TIER2, computeYppGates } from '@/lib/ypp-gates';

describe('YPP gate constants', () => {
  it('encodes the two monetization tiers', () => {
    expect(TIER1).toEqual({ subs: 500, hours: 3000 });
    expect(TIER2).toEqual({ subs: 1000, hours: 4000 });
  });
});

describe('computeYppGates', () => {
  it('below both gates: neither axis met, eta from the binding (slower-to-close) axis', () => {
    const g = computeYppGates({
      subscribers: 200,
      watchHours365: 1000,
      netSubsPerDay: 2, // 300 subs remaining to Tier1 → 150 days
      watchHoursPerDay: 10, // 2000 hrs remaining to Tier1 → 200 days (binding)
    });
    expect(g.tier1.subs).toEqual({ current: 200, target: 500, pct: 40, met: false });
    expect(g.tier1.hours).toEqual({ current: 1000, target: 3000, pct: expect.closeTo(33.3, 0) as unknown as number, met: false });
    expect(g.tier1.met).toBe(false);
    // hours gap closes slower (200d) than subs gap (150d) → eta = 200
    expect(g.tier1.etaDays).toBe(200);
  });

  it('subs-only-remaining (like now): hours met, subs not → eta from netSubsPerDay', () => {
    const g = computeYppGates({
      subscribers: 710,
      watchHours365: 4899,
      netSubsPerDay: 3, // Tier2: 290 remaining → ~97 days
      watchHoursPerDay: 20,
    });
    // Tier2 hours target 4000 already exceeded → met, pct capped 100
    expect(g.tier2.hours.met).toBe(true);
    expect(g.tier2.hours.pct).toBe(100);
    expect(g.tier2.subs.met).toBe(false);
    expect(g.tier2.met).toBe(false);
    // only the subs axis is still unmet → eta from subs gap / netSubsPerDay
    expect(g.tier2.etaDays).toBe(Math.round(290 / 3));
    // Tier1 is fully met (710>500, 4899>3000)
    expect(g.tier1.met).toBe(true);
    expect(g.tier1.etaDays).toBeNull();
  });

  it('fully met: both axes met → eta null', () => {
    const g = computeYppGates({
      subscribers: 1200,
      watchHours365: 5000,
      netSubsPerDay: 5,
      watchHoursPerDay: 30,
    });
    expect(g.tier2.subs.met).toBe(true);
    expect(g.tier2.hours.met).toBe(true);
    expect(g.tier2.met).toBe(true);
    expect(g.tier2.etaDays).toBeNull();
  });

  it('zero/negative pace on an unmet axis → eta null (cannot estimate)', () => {
    const g = computeYppGates({
      subscribers: 200,
      watchHours365: 1000,
      netSubsPerDay: 0, // subs not moving
      watchHoursPerDay: -5, // shrinking
    });
    expect(g.tier1.met).toBe(false);
    expect(g.tier1.etaDays).toBeNull();
  });

  it('caps pct at 100 and rounds sensibly', () => {
    const g = computeYppGates({
      subscribers: 750,
      watchHours365: 3300,
      netSubsPerDay: 1,
      watchHoursPerDay: 1,
    });
    // Tier1 both met
    expect(g.tier1.subs.pct).toBe(100);
    expect(g.tier1.hours.pct).toBe(100);
    // Tier2 subs 750/1000 = 75
    expect(g.tier2.subs.pct).toBe(75);
    // Tier2 hours 3300/4000 = 82.5
    expect(g.tier2.hours.pct).toBeCloseTo(82.5, 1);
  });
});
