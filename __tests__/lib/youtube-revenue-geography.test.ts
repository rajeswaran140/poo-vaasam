/**
 * UNIT TESTS — pure revenue-geography domain math.
 *
 * The point of this module is to answer "which songs pull the high-value
 * audience", so the tests are mostly about the ways that question gets
 * silently answered WRONG: averaging CPMs, dividing by monetized playbacks
 * instead of views, and dropping the real API rows that carry revenue with
 * zero attributed views.
 */

import {
  parseRevenueGeoRows,
  summarizeRevenueGeography,
  type RevenueGeoRawRow,
} from '@/lib/youtube-revenue-geography';

function row(over: Partial<RevenueGeoRawRow> = {}): RevenueGeoRawRow {
  return {
    country: 'IN',
    views: 0,
    estimatedRevenue: 0,
    estimatedAdRevenue: 0,
    estimatedRedPartnerRevenue: 0,
    adImpressions: 0,
    monetizedPlaybacks: 0,
    ...over,
  };
}

describe('parseRevenueGeoRows', () => {
  it('maps the Analytics column order into named fields', () => {
    const parsed = parseRevenueGeoRows([['CA', 3165, 8.413, 8.3, 0.113, 3520, 3250]]);
    expect(parsed).toEqual([
      {
        country: 'CA',
        views: 3165,
        estimatedRevenue: 8.413,
        estimatedAdRevenue: 8.3,
        estimatedRedPartnerRevenue: 0.113,
        adImpressions: 3520,
        monetizedPlaybacks: 3250,
      },
    ]);
  });

  it('tolerates null/undefined rows and missing cells', () => {
    expect(parseRevenueGeoRows(null)).toEqual([]);
    expect(parseRevenueGeoRows(undefined)).toEqual([]);
    expect(parseRevenueGeoRows([['IN']])[0]).toEqual(row({ country: 'IN' }));
  });
});

describe('summarizeRevenueGeography — RPM is revenue-weighted, never an average of CPMs', () => {
  /**
   * The trap this exists to prevent: YouTube returns a playbackBasedCpm per
   * country. Averaging those across countries answers a question nobody asked
   * and overstates the value of a catalogue whose views are concentrated in a
   * cheap market. RPM must be Σrevenue / Σviews.
   */
  it('weights by views rather than treating each country equally', () => {
    const s = summarizeRevenueGeography([
      row({ country: 'IN', views: 98065, estimatedRevenue: 21.406 }),
      row({ country: 'AU', views: 24, estimatedRevenue: 1.55 }),
    ]);
    // Per-country RPMs are $0.218 and $64.58; their unweighted mean is ~$32.4.
    const indiaRpm = 21.406 / 98065 * 1000;
    const ausRpm = 1.55 / 24 * 1000;
    expect(s.rows.find((r) => r.country === 'IN')!.rpm).toBeCloseTo(indiaRpm, 4);
    expect(s.rows.find((r) => r.country === 'AU')!.rpm).toBeCloseTo(ausRpm, 4);
    expect(s.rpm).toBeCloseTo((21.406 + 1.55) / (98065 + 24) * 1000, 4);
    expect(s.rpm).toBeLessThan(1); // NOT the ~$32 an unweighted mean would give
    expect(s.rpm).not.toBeCloseTo((indiaRpm + ausRpm) / 2, 1);
  });

  it('divides revenue by VIEWS, not by monetized playbacks (RPM is not CPM)', () => {
    // Only 60% of views carried an ad. RPM must still use all 1000 views.
    const s = summarizeRevenueGeography([
      row({ country: 'IN', views: 1000, monetizedPlaybacks: 600, estimatedRevenue: 2 }),
    ]);
    expect(s.rpm).toBeCloseTo(2, 6); // 2 / 1000 * 1000
    expect(s.monetizedPlaybackRate).toBeCloseTo(0.6, 6);
  });
});

describe('summarizeRevenueGeography — countries that earn with zero attributed views', () => {
  /**
   * Observed in the real API 2026-08-19: DK/NO/FI/BH/BE returned positive
   * revenue and ad impressions with views = 0 (small markets fall under the
   * geo-attribution threshold). Dropping them loses real money from the total;
   * dividing by their views is a crash.
   */
  it('keeps their revenue in the total and reports rpm as null, not Infinity', () => {
    const s = summarizeRevenueGeography([
      row({ country: 'IN', views: 1000, estimatedRevenue: 1 }),
      row({ country: 'NO', views: 0, estimatedRevenue: 0.228, adImpressions: 92 }),
    ]);
    expect(s.totalRevenue).toBeCloseTo(1.228, 6);
    expect(s.totalViews).toBe(1000);
    const no = s.rows.find((r) => r.country === 'NO')!;
    expect(no.rpm).toBeNull();
    expect(no.valueIndex).toBeNull();
    expect(Number.isFinite(s.rpm)).toBe(true);
  });
});

describe('summarizeRevenueGeography — rates use the video totals, not the country sums', () => {
  /**
   * REGRESSION, found against live data 2026-08-19 on lWt5kvapFKs. The country
   * dimension reports ad impressions and monetized playbacks for markets whose
   * VIEWS fall under the geo-attribution threshold. Summing the column
   * therefore under-counts views while fully counting everything else: 5,418
   * attributed views against 7,959 monetized playbacks produced a "monetized
   * rate" of 147% and an RPM inflated by the same factor — which then flowed
   * straight into rpmIndex and overstated every song against the channel.
   */
  const LIVE_SHAPE: RevenueGeoRawRow[] = [
    row({ country: 'IN', views: 5231, estimatedRevenue: 2.202, adImpressions: 7609, monetizedPlaybacks: 6009 }),
    row({ country: 'CA', views: 21, estimatedRevenue: 0.811, adImpressions: 398, monetizedPlaybacks: 335 }),
    row({ country: 'CH', views: 0, estimatedRevenue: 0.411, adImpressions: 103, monetizedPlaybacks: 71 }),
    row({ country: 'FR', views: 0, estimatedRevenue: 0.382, adImpressions: 276, monetizedPlaybacks: 211 }),
  ];

  it('never reports a monetized-playback rate above 100%', () => {
    const s = summarizeRevenueGeography(LIVE_SHAPE, {
      videoTotals: { views: 8900, estimatedRevenue: 5.166, monetizedPlaybacks: 6626 },
    });
    expect(s.monetizedPlaybackRate).toBeLessThanOrEqual(1);
    expect(s.monetizedPlaybackRate).toBeCloseTo(6626 / 8900, 6);
    expect(s.rpm).toBeCloseTo(5.166 / 8900 * 1000, 6);
    expect(s.rpmBasis).toBe('video-totals');
  });

  it('keeps the attributed sums available and separate from the true totals', () => {
    const s = summarizeRevenueGeography(LIVE_SHAPE, {
      videoTotals: { views: 8900, estimatedRevenue: 5.166, monetizedPlaybacks: 6626 },
    });
    expect(s.attributedViews).toBe(5252); // 5231 + 21 + 0 + 0
    expect(s.totalViews).toBe(8900);
    expect(s.attributedViews).toBeLessThan(s.totalViews);
  });

  it('flags the basis when no video totals are supplied, instead of hiding the overstatement', () => {
    const s = summarizeRevenueGeography(LIVE_SHAPE);
    expect(s.rpmBasis).toBe('country-attributed');
    expect(s.totalViews).toBe(s.attributedViews);
  });

  it('indexes against the channel using the corrected rpm', () => {
    const withTotals = summarizeRevenueGeography(LIVE_SHAPE, {
      channelRpm: 0.4274,
      videoTotals: { views: 8900, estimatedRevenue: 5.166, monetizedPlaybacks: 6626 },
    });
    const withoutTotals = summarizeRevenueGeography(LIVE_SHAPE, { channelRpm: 0.4274 });
    // The uncorrected path overstates the song's standing against the channel.
    expect(withoutTotals.rpmIndex!).toBeGreaterThan(withTotals.rpmIndex!);
    expect(withTotals.rpmIndex).toBeCloseTo((5.166 / 8900 * 1000) / 0.4274, 4);
  });

  // Shares come from the same partial accounting on both sides, so they stay
  // internally consistent and still sum to 100.
  it('leaves the country distribution intact', () => {
    const s = summarizeRevenueGeography(LIVE_SHAPE, {
      videoTotals: { views: 8900, estimatedRevenue: 5.166, monetizedPlaybacks: 6626 },
    });
    expect(s.rows.reduce((t, r) => t + r.revenueSharePct, 0)).toBeCloseTo(100, 4);
    expect(s.rows.reduce((t, r) => t + r.viewSharePct, 0)).toBeCloseTo(100, 4);
  });
});

describe('summarizeRevenueGeography — valueIndex is the "punches above its view share" signal', () => {
  it('is >1 where revenue share exceeds view share and <1 where it trails', () => {
    const s = summarizeRevenueGeography([
      row({ country: 'IN', views: 900, estimatedRevenue: 1 }),
      row({ country: 'CA', views: 100, estimatedRevenue: 4 }),
    ]);
    const ind = s.rows.find((r) => r.country === 'IN')!;
    const can = s.rows.find((r) => r.country === 'CA')!;
    expect(ind.viewSharePct).toBeCloseTo(90, 6);
    expect(ind.revenueSharePct).toBeCloseTo(20, 6);
    expect(ind.valueIndex).toBeCloseTo(20 / 90, 6);
    expect(can.valueIndex).toBeCloseTo(80 / 10, 6);
    expect(can.valueIndex!).toBeGreaterThan(1);
    expect(ind.valueIndex!).toBeLessThan(1);
  });

  it('sorts rows by revenue, so the money leads even when the views do not', () => {
    const s = summarizeRevenueGeography([
      row({ country: 'IN', views: 900, estimatedRevenue: 1 }),
      row({ country: 'CA', views: 100, estimatedRevenue: 4 }),
    ]);
    expect(s.rows.map((r) => r.country)).toEqual(['CA', 'IN']);
    expect(s.topRevenueCountry?.country).toBe('CA');
  });
});

describe('summarizeRevenueGeography — rpmIndex against the channel baseline', () => {
  it('is >1 for a song that pulls a higher-value audience than the channel', () => {
    const s = summarizeRevenueGeography(
      [row({ country: 'CA', views: 1000, estimatedRevenue: 2 })],
      { channelRpm: 0.427 }
    );
    expect(s.rpm).toBeCloseTo(2, 6);
    expect(s.rpmIndex).toBeCloseTo(2 / 0.427, 4);
  });

  it('is null when no channel baseline is available, rather than defaulting to 1', () => {
    // A missing baseline must READ as missing — 1.0 would say "exactly average",
    // which is an assertion we have not earned.
    const s = summarizeRevenueGeography([row({ country: 'IN', views: 10, estimatedRevenue: 1 })]);
    expect(s.rpmIndex).toBeNull();
    expect(summarizeRevenueGeography([row({ views: 10, estimatedRevenue: 1 })], { channelRpm: 0 }).rpmIndex).toBeNull();
  });
});

describe('summarizeRevenueGeography — monetization state', () => {
  it('reports servingAds false only when NO country recorded an ad impression', () => {
    const off = summarizeRevenueGeography([
      row({ country: 'IN', views: 500, adImpressions: 0 }),
      row({ country: 'CA', views: 50, adImpressions: 0 }),
    ]);
    expect(off.servingAds).toBe(false);
    expect(off.totalAdImpressions).toBe(0);

    const on = summarizeRevenueGeography([
      row({ country: 'IN', views: 500, adImpressions: 0 }),
      row({ country: 'CA', views: 50, adImpressions: 12, estimatedAdRevenue: 0.1 }),
    ]);
    expect(on.servingAds).toBe(true);
  });

  it('splits ad revenue from Premium revenue', () => {
    const s = summarizeRevenueGeography([
      row({ country: 'IN', views: 100, estimatedRevenue: 1.1, estimatedAdRevenue: 1, estimatedRedPartnerRevenue: 0.1 }),
    ]);
    expect(s.totalAdRevenue).toBeCloseTo(1, 6);
    expect(s.totalPremiumRevenue).toBeCloseTo(0.1, 6);
  });
});

describe('summarizeRevenueGeography — empty and degenerate input', () => {
  it('returns a zeroed summary rather than NaN', () => {
    for (const input of [[], null, undefined]) {
      const s = summarizeRevenueGeography(input as RevenueGeoRawRow[] | null | undefined);
      expect(s.rows).toEqual([]);
      expect(s.totalViews).toBe(0);
      expect(s.totalRevenue).toBe(0);
      expect(s.rpm).toBe(0);
      expect(s.monetizedPlaybackRate).toBe(0);
      expect(s.topRevenueCountry).toBeNull();
      expect(s.rpmIndex).toBeNull();
      expect(s.servingAds).toBe(false);
    }
  });

  it('drops rows with no country code but keeps a zero-view earner', () => {
    const s = summarizeRevenueGeography([
      row({ country: '', views: 10, estimatedRevenue: 5 }),
      row({ country: 'DK', views: 0, estimatedRevenue: 0.3 }),
    ]);
    expect(s.rows.map((r) => r.country)).toEqual(['DK']);
    expect(s.totalRevenue).toBeCloseTo(0.3, 6);
  });
});

describe('summarizeRevenueGeography — display decoration', () => {
  it('decorates each row with a country name and flag', () => {
    const s = summarizeRevenueGeography([row({ country: 'IN', views: 10, estimatedRevenue: 1 })]);
    expect(s.rows[0].countryName).toBe('India');
    expect(s.rows[0].flag).toBe('🇮🇳');
  });
});
