/**
 * Redistribution Score — "which song deserves another push, not another song?"
 *
 * The tests that matter here are the ones protecting against a score that looks
 * sensible and is quietly wrong: the theme confound, the two eligibility floors,
 * and the refusal to nominate a song that is merely least-bad.
 */

import {
  rankRedistribution,
  themeRelativeRetention,
  partitionEligible,
  topRediscovery,
  QUALITY_WEIGHTS,
  REACH_WEIGHTS,
  type RedistributionInput,
} from '@/lib/song-redistribution';
import { MIN_VELOCITY_AGE_DAYS, MIN_RATE_VIEWS } from '@/lib/youtube-outliers';

const song = (o: Partial<RedistributionInput> & { videoId: string }): RedistributionInput => ({
  title: `song ${o.videoId}`,
  views: 5000,
  ageDays: 120,
  viewsPerDay: 40,
  subsPer1k: 3,
  retention: 45,
  engagement: 0.5,
  likesPer1k: 12,
  sharesPer1k: 25,
  ...o,
});

describe('the two weightings are actually opposed', () => {
  it('quality carries no reach, and reach carries nothing else', () => {
    // If viewsPerDay appeared in both, the subtraction would cancel the very
    // signal the tool exists to find.
    expect(QUALITY_WEIGHTS.viewsPerDay).toBe(0);
    expect(REACH_WEIGHTS.viewsPerDay).toBe(1);
    const otherReach = Object.entries(REACH_WEIGHTS).filter(([k]) => k !== 'viewsPerDay');
    expect(otherReach.every(([, w]) => w === 0)).toBe(true);
  });
});

describe('eligibility floors', () => {
  it('excludes a song too young for its reach to be a durable rate', () => {
    const { eligible, ineligible } = partitionEligible([
      song({ videoId: 'young', ageDays: MIN_VELOCITY_AGE_DAYS - 1 }),
      song({ videoId: 'ok' }),
    ]);
    expect(eligible.map((s) => s.videoId)).toEqual(['ok']);
    expect(ineligible).toEqual([{ videoId: 'young', title: 'song young', reason: 'too-young' }]);
  });

  it('excludes a song whose per-1k rates are noise', () => {
    const { ineligible } = partitionEligible([song({ videoId: 'thin', views: MIN_RATE_VIEWS - 1 })]);
    expect(ineligible[0]).toMatchObject({ videoId: 'thin', reason: 'too-few-views' });
  });

  it('returns nothing rather than ranking an empty catalogue', () => {
    const { ranked, ineligible } = rankRedistribution([song({ videoId: 'a', ageDays: 1 })]);
    expect(ranked).toEqual([]);
    expect(ineligible).toHaveLength(1);
  });
});

/**
 * ⚠️ THE THEME CONFOUND — the defect this tool would have shipped with.
 *
 * Love songs retain 51-62% on this channel, grief/family 22-36%. Scoring
 * retention globally marks every non-love song as low quality and buries the
 * resonance lane, which is exactly what the tool is meant to surface.
 */
describe('retention is judged within theme, not against the whole catalogue', () => {
  const cat = [
    song({ videoId: 'love1', theme: 'love', retention: 58 }),
    song({ videoId: 'love2', theme: 'love', retention: 56 }),
    song({ videoId: 'love3', theme: 'love', retention: 52 }),
    song({ videoId: 'grief1', theme: 'grief', retention: 34 }),
    song({ videoId: 'grief2', theme: 'grief', retention: 30 }),
    song({ videoId: 'grief3', theme: 'grief', retention: 26 }),
  ];

  it('turns raw retention into distance from the theme median', () => {
    const out = themeRelativeRetention(cat);
    const by = Object.fromEntries(out.map((s) => [s.videoId, s.retention]));
    // love median 56, grief median 30
    expect(by.love1).toBeCloseTo(2);
    expect(by.love3).toBeCloseTo(-4);
    expect(by.grief1).toBeCloseTo(4);
    expect(by.grief3).toBeCloseTo(-4);
  });

  it('makes the BEST grief song outrank the WORST love song on retention', () => {
    // Globally, 34 < 52 and the grief song always loses. Theme-relative, the
    // grief song is +4 on its own kind and the love song is -4 on its.
    const out = themeRelativeRetention(cat);
    const g1 = out.find((s) => s.videoId === 'grief1')!.retention!;
    const l3 = out.find((s) => s.videoId === 'love3')!.retention!;
    expect(g1).toBeGreaterThan(l3);
  });

  it('leaves a thin theme alone — a 2-song median is not a yardstick', () => {
    const thin = [
      song({ videoId: 'solo1', theme: 'rare', retention: 40 }),
      song({ videoId: 'solo2', theme: 'rare', retention: 20 }),
    ];
    const out = themeRelativeRetention(thin, 3);
    expect(out.map((s) => s.retention)).toEqual([40, 20]);
  });

  it('leaves an untagged song alone', () => {
    const out = themeRelativeRetention([song({ videoId: 'x', theme: null, retention: 44 })]);
    expect(out[0].retention).toBe(44);
  });
});

describe('ranking finds the well-received, under-distributed song', () => {
  // A catalogue where one song converts well but barely gets shown.
  const cat = [
    song({ videoId: 'big', viewsPerDay: 900, subsPer1k: 3, retention: 44, sharesPer1k: 22, likesPer1k: 11 }),
    song({ videoId: 'mid', viewsPerDay: 300, subsPer1k: 3, retention: 45, sharesPer1k: 24, likesPer1k: 12 }),
    song({ videoId: 'mid2', viewsPerDay: 280, subsPer1k: 3, retention: 44, sharesPer1k: 25, likesPer1k: 12 }),
    // buried: top-of-catalogue advocacy, bottom-of-catalogue reach
    song({ videoId: 'buried', viewsPerDay: 12, subsPer1k: 9, retention: 62, sharesPer1k: 60, likesPer1k: 30 }),
  ];

  it('puts the buried song first', () => {
    const { ranked } = rankRedistribution(cat);
    expect(ranked[0].videoId).toBe('buried');
    expect(ranked[0].rank).toBe(1);
  });

  it('scores it as quality above the norm and reach below it', () => {
    const { ranked } = rankRedistribution(cat);
    const b = ranked.find((r) => r.videoId === 'buried')!;
    expect(b.quality).toBeGreaterThan(0);
    expect(b.reach).toBeLessThan(0);
    expect(b.score).toBeCloseTo(b.quality - b.reach);
  });

  it('ranks the widely-distributed song LAST — reach is not its constraint', () => {
    const { ranked } = rankRedistribution(cat);
    expect(ranked[ranked.length - 1].videoId).toBe('big');
  });

  it('explains itself in words derived from the numbers', () => {
    const { ranked } = rankRedistribution(cat);
    expect(ranked[0].why).toMatch(/under-distributed/i);
    expect(ranked[ranked.length - 1].why).toMatch(/reach is not the constraint/i);
  });

  it('is deterministic — equal scores break ties by id, never by input order', () => {
    const a = rankRedistribution(cat).ranked.map((r) => r.videoId);
    const b = rankRedistribution([...cat].reverse()).ranked.map((r) => r.videoId);
    expect(a).toEqual(b);
  });
});

describe('topRediscovery refuses to nominate a song that is merely least-bad', () => {
  it('returns the buried song when one genuinely qualifies', () => {
    const { ranked } = rankRedistribution([
      song({ videoId: 'big', viewsPerDay: 900, subsPer1k: 3, retention: 44, sharesPer1k: 22 }),
      song({ videoId: 'mid', viewsPerDay: 300, subsPer1k: 3, retention: 45, sharesPer1k: 24 }),
      song({ videoId: 'mid2', viewsPerDay: 280, subsPer1k: 3, retention: 44, sharesPer1k: 25 }),
      song({ videoId: 'buried', viewsPerDay: 12, subsPer1k: 9, retention: 62, sharesPer1k: 60, likesPer1k: 30 }),
    ]);
    expect(topRediscovery(ranked)?.videoId).toBe('buried');
  });

  it('returns null when the top song is below-norm on quality', () => {
    // Everything identical except reach: the "winner" is only winning because
    // it is the quietest, not because anyone responded to it.
    const flat = [
      song({ videoId: 'a', viewsPerDay: 500 }),
      song({ videoId: 'b', viewsPerDay: 400 }),
      song({ videoId: 'c', viewsPerDay: 10, subsPer1k: 1, retention: 20, sharesPer1k: 5, likesPer1k: 2 }),
    ];
    const { ranked } = rankRedistribution(flat);
    expect(topRediscovery(ranked)).toBeNull();
  });

  it('returns null on an empty catalogue rather than throwing', () => {
    expect(topRediscovery([])).toBeNull();
  });
});
