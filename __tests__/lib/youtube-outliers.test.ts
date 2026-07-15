/** @jest-environment node */
/**
 * Tests for src/lib/youtube-outliers.ts. Robust-stat helpers are checked against
 * independently hand-derived values (median/MAD by hand, Iglewicz–Hoaglin
 * modified z with its 1.4826 / 1.2533 consistency constants), and the composite
 * scoring is checked against hand-computed weighted means — not the code's own
 * output — so a regression in the math actually fails here.
 */

import {
  median,
  mad,
  modifiedZScores,
  rankOutliers,
  summarizeByTheme,
  indexThemesByVideo,
  deriveSignals,
  ageInDays,
  DEFAULT_WEIGHTS,
  DEFAULT_OUTLIER_THRESHOLD,
  SIGNAL_KEYS,
  type SongSignals,
  type RawVideoStats,
} from '@/lib/youtube-outliers';

describe('robust statistics', () => {
  it('median for odd and even lengths (order-independent)', () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5])).toBe(5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('mad is the median absolute deviation from the median', () => {
    // devs from median 3 are [2,1,0,1,2] → median 1
    expect(mad([1, 2, 3, 4, 5])).toBe(1);
    // majority tie → MAD 0
    expect(mad([10, 10, 10, 10, 100])).toBe(0);
  });

  it('modifiedZScores uses MAD·1.4826 as the scale', () => {
    // scale = 1 * 1.4826 → z = (x-3)/1.4826
    const z = modifiedZScores([1, 2, 3, 4, 5]);
    expect(z[0]).toBeCloseTo(-1.34898, 4);
    expect(z[2]).toBeCloseTo(0, 6);
    expect(z[4]).toBeCloseTo(1.34898, 4);
  });

  it('falls back to mean-abs-dev·1.2533 when MAD is 0', () => {
    // MAD([10,10,10,10,100])=0 → MeanAD = 90/5 = 18 → scale 18*1.2533=22.5594
    const z = modifiedZScores([10, 10, 10, 10, 100]);
    expect(z[0]).toBeCloseTo(0, 6);
    expect(z[4]).toBeCloseTo(90 / (18 * 1.2533), 4); // ≈ 3.9895
    expect(z[4]).toBeGreaterThan(3.5); // a genuine outlier
  });

  it('returns all-zeros when there is no spread at all', () => {
    expect(modifiedZScores([7, 7, 7])).toEqual([0, 0, 0]);
    expect(modifiedZScores([])).toEqual([]);
  });
});

// helper: build a bare song
function song(videoId: string, s: Partial<SongSignals>): SongSignals {
  return { videoId, title: videoId.toUpperCase(), ...s };
}

describe('rankOutliers', () => {
  it('empty catalogue → empty result', () => {
    expect(rankOutliers([])).toEqual([]);
  });

  it('a one-song catalogue has no norm → score 0, not an outlier', () => {
    const [r] = rankOutliers([song('a', { viewsPerDay: 5000 })]);
    expect(r.score).toBe(0);
    expect(r.isOutlier).toBe(false);
    expect(r.rank).toBe(1);
    expect(r.breakdown).toEqual([]);
  });

  it('single informative signal → score equals that signal z, ranked desc', () => {
    const songs = [1, 2, 3, 4, 5].map((v, i) => song(`s${i}`, { viewsPerDay: v }));
    const ranked = rankOutliers(songs);
    // score == viewsPerDay z (only one signal, weight cancels)
    expect(ranked[0].videoId).toBe('s4'); // highest viewsPerDay
    expect(ranked[0].score).toBeCloseTo(1.34898, 4);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[4].videoId).toBe('s0');
    expect(ranked[4].score).toBeCloseTo(-1.34898, 4);
    expect(ranked.every((r) => !r.isOutlier)).toBe(true); // none clears 2.0
  });

  it('flags a genuine breakout as an outlier at a chosen threshold', () => {
    const songs = [10, 10, 10, 10, 100].map((v, i) => song(`s${i}`, { viewsPerDay: v }));
    const ranked = rankOutliers(songs, { outlierThreshold: 3.0 });
    const top = ranked[0];
    expect(top.videoId).toBe('s4');
    expect(top.score).toBeCloseTo(90 / (18 * 1.2533), 3);
    expect(top.isOutlier).toBe(true);
    expect(ranked.slice(1).every((r) => !r.isOutlier)).toBe(true);
  });

  it('combines two signals as a weight-renormalized mean of their z-scores', () => {
    // viewsPerDay [1..5] → z multiples of 1/1.4826; retention [50,50,50,50,90]
    // → MAD 0 fallback, MeanAD 8, scale 10.0264, z(90)=3.98948
    const vpd = [1, 2, 3, 4, 5];
    const ret = [50, 50, 50, 50, 90];
    const songs = vpd.map((v, i) => song(`s${i}`, { viewsPerDay: v, retention: ret[i] }));
    const ranked = rankOutliers(songs);

    const top = ranked.find((r) => r.videoId === 's4')!;
    // (0.25*1.34886 + 0.20*3.98948) / 0.45 = 2.5225
    expect(top.score).toBeCloseTo(2.5225, 3);
    expect(top.rank).toBe(1);
    expect(top.isOutlier).toBe(true); // ≥ default 2.0
    // effective weights renormalize to sum to 1 over the two present signals
    const wSum = top.breakdown.reduce((s, b) => s + b.weight, 0);
    expect(wSum).toBeCloseTo(1, 6);
    const vpdW = top.breakdown.find((b) => b.key === 'viewsPerDay')!.weight;
    expect(vpdW).toBeCloseTo(0.25 / 0.45, 6);

    const s3 = ranked.find((r) => r.videoId === 's3')!;
    // (0.25*0.67449 + 0.20*0) / 0.45 = 0.3747
    expect(s3.score).toBeCloseTo(0.3747, 3);
  });

  it('a missing signal is not penalized — the song is scored on what it has', () => {
    const songs = [
      song('a', { viewsPerDay: 1, retention: 50 }),
      song('b', { viewsPerDay: 2, retention: 50 }),
      song('c', { viewsPerDay: 3, retention: 50 }),
      song('d', { viewsPerDay: 4, retention: 90 }),
      song('e', { viewsPerDay: 5 }), // no retention
    ];
    const ranked = rankOutliers(songs);
    const e = ranked.find((r) => r.videoId === 'e')!;
    // scored on viewsPerDay alone → weight renormalizes to 1
    expect(e.breakdown).toHaveLength(1);
    expect(e.breakdown[0].key).toBe('viewsPerDay');
    expect(e.breakdown[0].weight).toBeCloseTo(1, 6);
    expect(e.score).toBeCloseTo(1.34898, 4); // == viewsPerDay z of value 5
  });

  it('drops a signal that has no spread across the catalogue', () => {
    const songs = [1, 2, 3].map((v, i) => song(`s${i}`, { viewsPerDay: v, retention: 60 }));
    const ranked = rankOutliers(songs);
    // retention is constant → non-informative → excluded from every breakdown
    for (const r of ranked) {
      expect(r.breakdown.some((b) => b.key === 'retention')).toBe(false);
    }
  });

  it('keeps input order for ties (stable sort)', () => {
    // all-equal viewsPerDay → non-informative → all scores 0 → original order kept
    const songs = ['x', 'y', 'z'].map((id) => song(id, { viewsPerDay: 100 }));
    const ranked = rankOutliers(songs);
    expect(ranked.map((r) => r.videoId)).toEqual(['x', 'y', 'z']);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
  });

  it('respects custom weights', () => {
    const songs = [
      song('a', { viewsPerDay: 1, retention: 90 }),
      song('b', { viewsPerDay: 2, retention: 50 }),
      song('c', { viewsPerDay: 3, retention: 50 }),
      song('d', { viewsPerDay: 4, retention: 50 }),
      song('e', { viewsPerDay: 5, retention: 50 }),
    ];
    // Weight retention only → 'a' (the high-retention song) should win despite low views.
    const w = { ...DEFAULT_WEIGHTS, viewsPerDay: 0, retention: 1 };
    const ranked = rankOutliers(songs, { weights: w });
    expect(ranked[0].videoId).toBe('a');
  });
});

describe('summarizeByTheme', () => {
  it('groups by theme, means the scores + raw signals, sorts by mean score', () => {
    const songs = [
      song('m1', { theme: 'mother', viewsPerDay: 5 }),
      song('m2', { theme: 'mother', viewsPerDay: 4 }),
      song('l1', { theme: 'love', viewsPerDay: 2 }),
      song('l2', { theme: 'love', viewsPerDay: 1 }),
    ];
    const ranked = rankOutliers(songs);
    const summary = summarizeByTheme(ranked, songs);

    expect(summary.map((t) => t.theme)).toEqual(['mother', 'love']); // mother scores higher
    const mother = summary[0];
    expect(mother.count).toBe(2);
    expect(mother.meanSignals.viewsPerDay).toBeCloseTo(4.5, 6);
    expect(mother.meanScore).toBeGreaterThan(summary[1].meanScore);
    // scores are symmetric around 0 here → love mean is the negative of mother mean
    expect(mother.meanScore).toBeCloseTo(-summary[1].meanScore, 6);
  });

  it('untagged songs fall into the (untagged) group', () => {
    const songs = [
      song('a', { theme: 'nature', viewsPerDay: 5 }),
      song('b', { viewsPerDay: 4 }), // no theme
      song('c', { theme: '', viewsPerDay: 3 }), // blank theme
    ];
    const ranked = rankOutliers(songs);
    const summary = summarizeByTheme(ranked, songs);
    const untagged = summary.find((t) => t.theme === '(untagged)')!;
    expect(untagged.count).toBe(2);
  });

  it('counts outliers per theme', () => {
    const songs = [10, 10, 10, 10, 100].map((v, i) =>
      song(`s${i}`, { theme: i === 4 ? 'breakout' : 'normal', viewsPerDay: v })
    );
    const ranked = rankOutliers(songs, { outlierThreshold: 3 });
    const summary = summarizeByTheme(ranked, songs);
    expect(summary.find((t) => t.theme === 'breakout')!.outlierCount).toBe(1);
    expect(summary.find((t) => t.theme === 'normal')!.outlierCount).toBe(0);
  });
});

describe('indexThemesByVideo', () => {
  it('maps videoId → theme', () => {
    const m = indexThemesByVideo([
      { youtubeVideoId: 'aaa', theme: 'mother' },
      { youtubeVideoId: 'bbb', theme: 'love' },
    ]);
    expect(m.get('aaa')).toBe('mother');
    expect(m.get('bbb')).toBe('love');
    expect(m.size).toBe(2);
  });

  it('skips entries with no/blank videoId and trims the id', () => {
    const m = indexThemesByVideo([
      { youtubeVideoId: null, theme: 'mother' },
      { youtubeVideoId: '   ', theme: 'love' },
      { youtubeVideoId: ' ccc ', theme: 'nature' },
    ]);
    expect(m.has('ccc')).toBe(true);
    expect(m.size).toBe(1);
  });

  it('first entry wins on a duplicate id (deterministic)', () => {
    const m = indexThemesByVideo([
      { youtubeVideoId: 'dup', theme: 'mother' },
      { youtubeVideoId: 'dup', theme: 'love' },
    ]);
    expect(m.get('dup')).toBe('mother');
  });

  it('skips entries with no theme', () => {
    const m = indexThemesByVideo([
      { youtubeVideoId: 'x', theme: null },
      { youtubeVideoId: 'y', theme: '' },
    ]);
    expect(m.size).toBe(0);
  });
});

describe('ageInDays', () => {
  it('floors whole days from publish instant to the asOf date-end', () => {
    // 2026-06-15T12:00Z → 2026-07-15 end-of-day = 30 days and change → 30
    expect(ageInDays('2026-06-15T12:00:00Z', '2026-07-15')).toBe(30);
  });

  it('never returns less than 1 (same-day publish)', () => {
    expect(ageInDays('2026-07-15T00:00:00Z', '2026-07-15')).toBe(1);
  });

  it('guards against unparseable dates', () => {
    expect(ageInDays('not-a-date', '2026-07-15')).toBe(1);
  });
});

describe('deriveSignals', () => {
  const asOf = '2026-07-15';
  const base: RawVideoStats = {
    videoId: 'v1',
    title: 'Song One',
    theme: 'mother',
    publishedAt: '2026-06-15T12:00:00Z', // 30 days before asOf-end
    views: 3000,
    subscribersGained: 30,
    comments: 6,
    retention: 44.5,
    ctr: 5.2,
    growth30d: 1.3,
  };

  it('derives per-day and per-1k rates from raw counts', () => {
    const s = deriveSignals(base, asOf);
    expect(s.viewsPerDay).toBeCloseTo(3000 / 30, 6); // 100/day
    expect(s.subsPer1k).toBeCloseTo(10, 6); // 30/3000*1000
    expect(s.engagement).toBeCloseTo(2, 6); // 6/3000*1000
    // pass-through analytics signals
    expect(s.retention).toBe(44.5);
    expect(s.ctr).toBe(5.2);
    expect(s.growth30d).toBe(1.3);
    expect(s.theme).toBe('mother');
  });

  it('null rate-source counts stay null (not measured), not 0', () => {
    const s = deriveSignals({ ...base, subscribersGained: null, comments: null }, asOf);
    expect(s.subsPer1k).toBeNull();
    expect(s.engagement).toBeNull();
  });

  it('zero views → 0 rates (no divide-by-zero)', () => {
    const s = deriveSignals({ ...base, views: 0 }, asOf);
    expect(s.viewsPerDay).toBe(0);
    expect(s.subsPer1k).toBe(0);
    expect(s.engagement).toBe(0);
  });
});

describe('module constants', () => {
  it("default weights match Raj's spec and are all present", () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      viewsPerDay: 0.25,
      subsPer1k: 0.2,
      retention: 0.2,
      ctr: 0.2,
      engagement: 0.1,
      growth30d: 0.05,
    });
    // every signal key is weighted
    expect(SIGNAL_KEYS.every((k) => k in DEFAULT_WEIGHTS)).toBe(true);
    expect(DEFAULT_OUTLIER_THRESHOLD).toBe(2.0);
  });
});
