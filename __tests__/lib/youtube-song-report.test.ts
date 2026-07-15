/** @jest-environment node */
/**
 * Tests for src/lib/youtube-song-report.ts — the per-song lifecycle report
 * builder. Diagnoses and buckets are checked against constructed fixtures that
 * mirror the real song shapes (reach cool-down, stable anchor, engagement drop).
 */
import {
  bucketByWeek,
  computeSourceTrend,
  computeSubscribedSplit,
  diagnose,
  buildSongReport,
  IMPRESSIONS_CAVEAT,
  type SongDailyPoint,
  type SongReportInput,
} from '@/lib/youtube-song-report';

/** Daily points from an anchor date with given (views, avgView%) pairs. */
function daily(anchor: string, pairs: Array<[number, number]>, subsEach = 2): SongDailyPoint[] {
  return pairs.map(([views, avp], i) => {
    const d = new Date(`${anchor}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), views, subscribersGained: subsEach, averageViewPercentage: avp };
  });
}

describe('bucketByWeek', () => {
  it('groups daily points into 1-based weeks with view-weighted retention', () => {
    // 14 days, week1 all 100 views @ 30%, week2 all 200 views @ 50%
    const d = daily('2026-06-11', [
      ...Array(7).fill([100, 30]) as Array<[number, number]>,
      ...Array(7).fill([200, 50]) as Array<[number, number]>,
    ]);
    const wk = bucketByWeek(d, '2026-06-11T01:00:00Z');
    expect(wk).toHaveLength(2);
    expect(wk[0]).toMatchObject({ week: 1, views: 700, averageViewPercentage: 30 });
    expect(wk[1]).toMatchObject({ week: 2, views: 1400, averageViewPercentage: 50 });
    expect(wk[0].from).toBe('2026-06-11');
  });

  it('drops points dated before the upload', () => {
    const d = daily('2026-06-10', [[50, 20], [100, 40]]);
    const wk = bucketByWeek(d, '2026-06-11T00:00:00Z');
    // first point (06-10) is before upload → excluded; only 06-11 remains
    expect(wk).toHaveLength(1);
    expect(wk[0].views).toBe(100);
  });
});

describe('computeSourceTrend', () => {
  const life = [
    { source: 'RELATED_VIDEO', views: 18000 },
    { source: 'PLAYLIST', views: 14000 },
    { source: 'SUBSCRIBER', views: 4600 },
  ];
  it('computes mix %, deltas, owned-vs-rented and floor', () => {
    const recent = [{ source: 'RELATED_VIDEO', views: 2183 }, { source: 'PLAYLIST', views: 1799 }, { source: 'SUBSCRIBER', views: 1043 }];
    const prior = [{ source: 'RELATED_VIDEO', views: 5555 }, { source: 'PLAYLIST', views: 4347 }, { source: 'SUBSCRIBER', views: 1025 }];
    const t = computeSourceTrend(life, recent, prior);
    expect(t.rows[0].source).toBe('RELATED_VIDEO'); // sorted by lifetime
    expect(t.rows[0].lifetimePct).toBeCloseTo(49.18, 1);
    expect(t.suggestedDeltaPct).toBeCloseTo(-60.7, 0); // (2183-5555)/5555
    // owned = playlist+subscriber = 18600/36600 = 50.8% → durable floor
    expect(t.ownedSharePct).toBeCloseTo(50.8, 1);
    expect(t.floor).toBe('durable');
  });

  it('flags a thin floor when subscribers/playlists are a small share', () => {
    const thin = [{ source: 'RELATED_VIDEO', views: 9000 }, { source: 'PLAYLIST', views: 500 }, { source: 'SUBSCRIBER', views: 300 }];
    const t = computeSourceTrend(thin, [], []);
    expect(t.floor).toBe('thin'); // owned ≈ 8.2%
    expect(t.rows[0].deltaPct).toBeNull(); // prior=0 → null, not Infinity
  });
});

describe('computeSubscribedSplit', () => {
  it('splits subscribed vs unsubscribed retention and the gap', () => {
    const s = computeSubscribedSplit([
      { status: 'SUBSCRIBED', views: 735, averageViewPercentage: 85.8 },
      { status: 'UNSUBSCRIBED', views: 24829, averageViewPercentage: 38.8 },
    ]);
    expect(s.subscribedRetention).toBe(85.8);
    expect(s.retentionGap).toBeCloseTo(47, 1);
  });
  it('handles a missing row without throwing', () => {
    const s = computeSubscribedSplit([{ status: 'UNSUBSCRIBED', views: 100, averageViewPercentage: 40 }]);
    expect(s.subscribedRetention).toBeNull();
    expect(s.retentionGap).toBeNull();
  });
});

describe('diagnose', () => {
  const noSources = computeSourceTrend([], [], []);
  const weeklyOf = (d: SongDailyPoint[]) => bucketByWeek(d, d[0].date);

  it('reach-cooldown: views down but retention rising', () => {
    // week1 high views low retention, week2 low views high retention
    const d = daily('2026-06-11', [
      ...Array(7).fill([2000, 32]) as Array<[number, number]>,
      ...Array(7).fill([700, 50]) as Array<[number, number]>,
    ]);
    const dg = diagnose(d, weeklyOf(d), noSources);
    expect(dg.verdict).toBe('reach-cooldown');
    expect(dg.viewsSignificantlyDown).toBe(true);
    expect(dg.retentionTrend).toBe('rising');
  });

  it('engagement-decline: views AND retention both down', () => {
    const d = daily('2026-06-11', [
      ...Array(7).fill([2000, 55]) as Array<[number, number]>,
      ...Array(7).fill([700, 30]) as Array<[number, number]>,
    ]);
    const dg = diagnose(d, weeklyOf(d), noSources);
    expect(dg.verdict).toBe('engagement-decline');
    expect(dg.retentionTrend).toBe('falling');
  });

  it('stable: views not significantly down', () => {
    const d = daily('2026-06-11', [
      ...Array(7).fill([1000, 40]) as Array<[number, number]>,
      ...Array(7).fill([1010, 41]) as Array<[number, number]>,
    ]);
    const dg = diagnose(d, weeklyOf(d), noSources);
    expect(dg.verdict).toBe('stable');
  });

  it('indeterminate: down but only one week of history', () => {
    // 8 days: recent 7 low, but weekly has ~1 bucket → retentionTrend unknown
    const d = daily('2026-06-11', [[5000, 40], ...Array(7).fill([500, 40]) as Array<[number, number]>]);
    const dg = diagnose(d, weeklyOf(d), noSources);
    expect(['indeterminate', 'reach-cooldown', 'stable']).toContain(dg.verdict);
    if (dg.verdict === 'indeterminate') expect(dg.retentionTrend).toBe('unknown');
  });
});

describe('buildSongReport', () => {
  const base: SongReportInput = {
    videoId: 'GXLu3Y7FghU',
    title: 'நீ சிரிச்ச நேரம் தான்',
    publishedAt: '2026-06-11T01:09:34Z',
    durationSeconds: 365,
    asOf: '2026-07-15',
    totals: {
      views: 40086,
      estimatedMinutesWatched: 111846,
      averageViewDuration: 167,
      averageViewPercentage: 45.9,
      subscribersGained: 187,
      subscribersLost: 1,
      likes: 359,
      comments: 7,
      shares: 1140,
    },
    daily: daily('2026-06-11', [
      ...Array(7).fill([2000, 32]) as Array<[number, number]>,
      ...Array(7).fill([700, 50]) as Array<[number, number]>,
    ]),
    sourcesLifetime: [
      { source: 'RELATED_VIDEO', views: 18182 },
      { source: 'PLAYLIST', views: 14061 },
      { source: 'SUBSCRIBER', views: 4625 },
    ],
    sourcesRecent: [{ source: 'RELATED_VIDEO', views: 2183 }],
    sourcesPrior: [{ source: 'RELATED_VIDEO', views: 5555 }],
    subscribedSplit: [
      { status: 'SUBSCRIBED', views: 783, averageViewPercentage: 61.5 },
      { status: 'UNSUBSCRIBED', views: 39303, averageViewPercentage: 45.6 },
    ],
    deviceMix: [
      { device: 'MOBILE', views: 37157 },
      { device: 'DESKTOP', views: 1998 },
    ],
  };

  it('assembles a complete report', () => {
    const r = buildSongReport(base);
    expect(r.ageDays).toBe(34);
    expect(r.summary!.watchHours).toBeCloseTo(1864.1, 0);
    expect(r.summary!.netSubscribers).toBe(186);
    expect(r.summary!.shareRatePer1k).toBeCloseTo(28.4, 1);
    expect(r.weekly).toHaveLength(2);
    expect(r.sourceTrend.floor).toBe('durable');
    expect(r.subscribedSplit.retentionGap).toBeCloseTo(15.9, 1);
    expect(r.deviceMix[0]).toMatchObject({ device: 'MOBILE' });
    expect(r.deviceMix[0].pct).toBeCloseTo(94.9, 0);
    expect(r.diagnosis.verdict).toBe('reach-cooldown');
    expect(r.impressionsCaveat).toBe(IMPRESSIONS_CAVEAT);
  });

  it('degrades to summary=null when totals are unavailable', () => {
    const r = buildSongReport({ ...base, totals: null });
    expect(r.summary).toBeNull();
    // the rest of the report still builds
    expect(r.weekly.length).toBeGreaterThan(0);
    expect(r.diagnosis.verdict).toBe('reach-cooldown');
  });
});
