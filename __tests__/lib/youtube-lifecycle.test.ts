/**
 * Song Lifecycle tests.
 *
 * The fixture is REAL catalogue data (six songs, publish date → 2026-08-17, the
 * last finalized day at capture). The point of these tests is the one stated in
 * docs/SONG_LIFECYCLE.md build order step 2: the classifier must reproduce what
 * we already know about these songs, or the rules are wrong.
 */

import fixtures from '../fixtures/lifecycle-songs.json';
import {
  CLASSIFY_MIN_AGE,
  CPR_MIN_AGE,
  MIN_PEERS,
  ageMatchedPercentile,
  catalogPersistenceRatio,
  classifyArchetype,
  classifyPerformance,
  computeFeatures,
  computeMilestones,
  smooth,
  toAgeSeries,
  type LifecycleFeatures,
  type LifecycleInput,
} from '@/lib/youtube-lifecycle';

const inputs = fixtures as unknown as (LifecycleInput & { note: string; title: string })[];
const byId = (id: string) => inputs.find((f) => f.videoId === id)!;
const featuresOf = (id: string) => computeFeatures(byId(id))!;

/** நீ சிரிச்ச நேரம் — the channel's #1 song by reach. */
const NEE_SIRICHCHA = 'GXLu3Y7FghU';
/** முத்தமிழின் மூன்றெழுத்தில் — peaked on D44 from 94 views in D0-D3. */
const MUTHAMIZHIN = 'J2tc_aUNOPA';
/** என் மன்னவனே. */
const EN_MANNAVANE = 'eo3Mo--sgPY';
/** ஒத்த பனங்கீத்தே. */
const OTHTHA = 'I0F7xHxg7cI';
/** செவ்வந்தி பூவே. */
const SEVVANTHI = 'H5NcoS41fA4';
/** A Short. */
const SHORT = 'Ra6pKpTMx8w';

describe('youtube-lifecycle', () => {
  describe('smooth', () => {
    it('preserves length so ages stay aligned', () => {
      expect(smooth([1, 2, 3, 4, 5])).toHaveLength(5);
    });

    it('is a trailing mean', () => {
      expect(smooth([3, 3, 3, 9], 3)).toEqual([3, 3, 3, 5]);
    });
  });

  describe('toAgeSeries', () => {
    it('indexes day 0 at the publish date', () => {
      const series = toAgeSeries({
        videoId: 'x',
        publishedAt: '2026-08-01',
        durationSeconds: 300,
        lastFinalizedDay: '2026-08-04',
        daily: [
          { day: '2026-08-01', views: 10 },
          { day: '2026-08-03', views: 30 },
        ],
      });
      expect(series).toEqual([10, 0, 30, 0]);
    });

    it('ignores days outside the observable span', () => {
      const series = toAgeSeries({
        videoId: 'x',
        publishedAt: '2026-08-01',
        durationSeconds: 300,
        lastFinalizedDay: '2026-08-02',
        daily: [
          { day: '2026-07-30', views: 99 },
          { day: '2026-08-09', views: 99 },
          { day: '2026-08-02', views: 5 },
        ],
      });
      expect(series).toEqual([0, 5]);
    });
  });

  describe('computeMilestones', () => {
    it('returns null — never 0 — for a milestone the song has not reached', () => {
      const m = computeMilestones([100, 50, 25], 2);
      expect(m.D1).toBe(150);
      expect(m.D7).toBeNull();
      expect(m.D28).toBeNull();
    });

    it('does not confuse an unreached milestone with a zero-view one', () => {
      const m = computeMilestones([0, 0, 0, 0, 0, 0, 0, 0], 7);
      expect(m.D7).toBe(0);
      expect(m.D14).toBeNull();
    });
  });

  describe('catalogPersistenceRatio', () => {
    it('is null before the minimum age', () => {
      expect(catalogPersistenceRatio([100, 10, 5], CPR_MIN_AGE - 1)).toBeNull();
    });

    it('is 0 for a song that stopped distributing after D7', () => {
      const series = [...Array(8).fill(100), ...Array(20).fill(0)];
      expect(catalogPersistenceRatio(series, 27)).toBe(0);
    });

    it('approaches 1 for a song whose distribution began after D7', () => {
      const series = [...Array(8).fill(0), ...Array(20).fill(100)];
      expect(catalogPersistenceRatio(series, 27)).toBe(1);
    });
  });

  // ---- The validation that matters: known songs must come out right --------

  describe('classifyArchetype against known catalogue songs', () => {
    it('classifies நீ சிரிச்ச நேரம் as a Delayed breakout', () => {
      const f = featuresOf(NEE_SIRICHCHA);
      expect(classifyArchetype(f)).toBe('Delayed breakout');
      expect(f.peakDay).toBeGreaterThanOrEqual(20);
    });

    it('classifies முத்தமிழின் as a Delayed breakout peaking after D40', () => {
      const f = featuresOf(MUTHAMIZHIN);
      expect(classifyArchetype(f)).toBe('Delayed breakout');
      expect(f.peakDay).toBeGreaterThan(40);
      // 94 views in D0-D3 — a launch reading would have called this a failure.
      expect(f.earlyVelocity).toBeLessThan(150);
      expect(f.cpr).toBeGreaterThan(0.9);
    });

    it('classifies ஒத்த பனங்கீத்தே as Early burst-decay', () => {
      const f = featuresOf(OTHTHA);
      expect(classifyArchetype(f)).toBe('Early burst-decay');
      expect(f.peakDay).toBeLessThanOrEqual(2);
    });

    it('classifies செவ்வந்தி பூவே as Multi-wave', () => {
      const f = featuresOf(SEVVANTHI);
      expect(classifyArchetype(f)).toBe('Multi-wave');
      expect(f.waveCount).toBeGreaterThanOrEqual(2);
    });

    it('classifies என் மன்னவனே as Slow burn', () => {
      expect(classifyArchetype(featuresOf(EN_MANNAVANE))).toBe('Slow burn');
    });

    it('is size-blind: a 5k-view song and a 54k-view song can share an archetype', () => {
      const big = featuresOf(NEE_SIRICHCHA);
      const small = featuresOf(MUTHAMIZHIN);
      expect(classifyArchetype(big)).toBe(classifyArchetype(small));
      expect(big.totalViews).toBeGreaterThan(10 * small.totalViews);
    });
  });

  describe('CPR separates Shorts from long-form without being told the format', () => {
    it('scores the Short far below the long-form songs', () => {
      const short = featuresOf(SHORT);
      const longForm = [NEE_SIRICHCHA, EN_MANNAVANE, SEVVANTHI].map(featuresOf);
      expect(short.isShort).toBe(true);
      for (const f of longForm) {
        expect(f.isShort).toBe(false);
        expect(f.cpr!).toBeGreaterThan(short.cpr!);
      }
      expect(short.cpr!).toBeLessThan(0.45);
    });
  });

  describe('ageMatchedPercentile', () => {
    const all = inputs.map((i) => computeFeatures(i)!).filter(Boolean);

    it('returns null rather than a number derived from too few peers', () => {
      // The oldest song has almost no peers that have reached its age.
      const oldest = all.reduce((a, b) => (a.observableAge > b.observableAge ? a : b));
      expect(ageMatchedPercentile(oldest, all)).toBeNull();
    });

    it('compares like with like — Shorts are not scored against long-form', () => {
      const short = featuresOf(SHORT);
      const result = ageMatchedPercentile(short, all);
      // Only one Short in the fixture, so there is nothing valid to compare against.
      expect(result).toBeNull();
    });

    it('ranks a song above peers it genuinely outperformed at the same age', () => {
      const target = featuresOf(OTHTHA);
      const peers: LifecycleFeatures[] = [
        target,
        ...Array.from({ length: MIN_PEERS }, (_, i) => ({
          ...featuresOf(EN_MANNAVANE),
          videoId: `peer-${i}`,
          series: new Array(target.observableAge + 1).fill(1),
        })),
      ];
      const result = ageMatchedPercentile(target, peers)!;
      expect(result.peerCount).toBe(MIN_PEERS);
      expect(result.percentile).toBe(100);
    });
  });

  describe('classifyPerformance', () => {
    it("returns 'Developing' — not a poor grade — before the classification age", () => {
      const young = { ...featuresOf(OTHTHA), observableAge: CLASSIFY_MIN_AGE - 1 };
      expect(classifyPerformance(young, { percentile: 5, peerCount: 40 })).toBe('Developing');
    });

    it('suppresses the class entirely when there are too few peers', () => {
      expect(classifyPerformance(featuresOf(NEE_SIRICHCHA), null)).toBeNull();
    });

    it('calls a low-percentile song that is still accumulating a Slow-burn, not Weak', () => {
      const f = { ...featuresOf(MUTHAMIZHIN) };
      expect(f.cpr!).toBeGreaterThan(0.7);
      expect(classifyPerformance(f, { percentile: 20, peerCount: 30 })).toBe('Slow-burn');
    });

    it('calls a low-percentile song that has stopped accumulating Weak', () => {
      const f = { ...featuresOf(MUTHAMIZHIN), cpr: 0.2, residualVelocity: 0.01 };
      expect(classifyPerformance(f, { percentile: 20, peerCount: 30 })).toBe('Weak');
    });

    it('grades the channel #1 song as a Breakout', () => {
      const f = featuresOf(NEE_SIRICHCHA);
      expect(classifyPerformance(f, { percentile: 100, peerCount: 30 })).toBe('Breakout');
    });
  });

  describe('honesty guards', () => {
    it('exposes no impressions or CTR field — they do not exist in the API', () => {
      const f = featuresOf(NEE_SIRICHCHA) as unknown as Record<string, unknown>;
      expect(f).not.toHaveProperty('impressions');
      expect(f).not.toHaveProperty('impressionsClickThroughRate');
      expect(f).not.toHaveProperty('clickThroughRate');
    });

    it('refuses to score a song below the minimum view floor', () => {
      expect(
        computeFeatures({
          videoId: 'tiny',
          publishedAt: '2026-08-01',
          durationSeconds: 300,
          lastFinalizedDay: '2026-08-14',
          daily: [{ day: '2026-08-01', views: 3 }],
        }),
      ).toBeNull();
    });
  });
});
