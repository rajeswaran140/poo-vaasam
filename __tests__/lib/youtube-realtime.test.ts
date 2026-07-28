import {
  pickAnchor,
  computeViewDelta,
  deriveRealtime,
  isSubscriberCountRounded,
  anchorTargetIso,
  ANCHOR_TOLERANCE_HOURS,
  REALTIME_WINDOW_HOURS,
  type ChannelSnapshot,
} from '@/lib/youtube-realtime';

const snap = (capturedAt: string, viewCount: number, subscriberCount = 1110): ChannelSnapshot => ({
  capturedAt,
  viewCount,
  subscriberCount,
  videoCount: 86,
});

const NOW = '2026-07-28T12:00:00.000Z';
const TARGET = '2026-07-26T12:00:00.000Z'; // NOW − 48h

describe('anchorTargetIso', () => {
  it('targets exactly 48h before the reference instant', () => {
    expect(anchorTargetIso(new Date(NOW))).toBe(TARGET);
    expect(REALTIME_WINDOW_HOURS).toBe(48);
  });
});

describe('pickAnchor', () => {
  it('returns null when there are no candidates (first 48h after deploy)', () => {
    expect(pickAnchor([], TARGET, NOW)).toBeNull();
  });

  it('picks the snapshot closest to the target, not merely the first', () => {
    const picked = pickAnchor(
      [snap('2026-07-26T10:00:00Z', 100), snap('2026-07-26T11:55:00Z', 200), snap('2026-07-26T14:00:00Z', 300)],
      TARGET,
      NOW
    );
    expect(picked!.snapshot.viewCount).toBe(200);
    expect(picked!.withinTolerance).toBe(true);
  });

  it('reports the TRUE window length, not the assumed 48h', () => {
    // Anchor is 61h before NOW — the gap scenario.
    const picked = pickAnchor([snap('2026-07-25T23:00:00Z', 100)], TARGET, NOW);
    expect(picked!.windowMs / 3_600_000).toBeCloseTo(61, 5);
  });

  it('flags an anchor outside the tolerance band rather than silently accepting it', () => {
    const picked = pickAnchor([snap('2026-07-25T23:00:00Z', 100)], TARGET, NOW);
    expect(picked!.withinTolerance).toBe(false);
  });

  it('accepts an anchor exactly at the tolerance edge', () => {
    const edge = new Date(Date.parse(TARGET) - ANCHOR_TOLERANCE_HOURS * 3_600_000).toISOString();
    expect(pickAnchor([snap(edge, 100)], TARGET, NOW)!.withinTolerance).toBe(true);
  });

  it('ignores candidates with an unparseable timestamp', () => {
    const picked = pickAnchor([snap('not-a-date', 999), snap('2026-07-26T12:01:00Z', 500)], TARGET, NOW);
    expect(picked!.snapshot.viewCount).toBe(500);
  });
});

describe('computeViewDelta (viewCount is not monotonic)', () => {
  it('computes a normal positive delta', () => {
    expect(computeViewDelta(297_666, 286_828)).toEqual({ views: 10_838, decreased: false, raw: 10_838 });
  });

  it('clamps a spam-sweep decrease to zero instead of rendering negative', () => {
    const d = computeViewDelta(100, 450);
    expect(d.views).toBe(0);
    expect(d.decreased).toBe(true);
  });

  it('preserves the raw negative so a sweep can be logged, not swallowed', () => {
    expect(computeViewDelta(100, 450).raw).toBe(-350);
  });

  it('treats an unchanged counter as zero views, not as missing data', () => {
    expect(computeViewDelta(500, 500)).toEqual({ views: 0, decreased: false, raw: 0 });
  });
});

describe('isSubscriberCountRounded', () => {
  it('flags counts at or above 1,000 as rounded by Google', () => {
    expect(isSubscriberCountRounded(1110)).toBe(true);
    expect(isSubscriberCountRounded(1000)).toBe(true);
  });

  it('treats sub-1,000 counts as exact', () => {
    expect(isSubscriberCountRounded(999)).toBe(false);
  });
});

describe('deriveRealtime', () => {
  it('returns an all-null reading before the first snapshot exists', () => {
    const r = deriveRealtime(null, null);
    expect(r.subscribersApprox).toBeNull();
    expect(r.views48hAvailable).toBe(false);
    expect(r.views48h).toBeNull();
  });

  it('renders subscribers but suppresses views for the first 48h (no anchor)', () => {
    const r = deriveRealtime(snap(NOW, 297_666), null);
    expect(r.subscribersApprox).toBe(1110);
    expect(r.views48h).toBeNull();
    expect(r.views48hAvailable).toBe(false);
  });

  it('produces the full reading with a good anchor', () => {
    const anchor = pickAnchor([snap('2026-07-26T12:00:00Z', 286_828)], TARGET, NOW)!;
    const r = deriveRealtime(snap(NOW, 297_666), anchor);
    expect(r.views48h).toBe(10_838);
    expect(r.views48hAvailable).toBe(true);
    expect(r.windowHours).toBe(48);
    expect(r.windowExact).toBe(true);
    expect(r.subscribersRounded).toBe(true);
  });

  it('reports the real window and marks it inexact when there was a gap', () => {
    const anchor = pickAnchor([snap('2026-07-25T23:00:00Z', 286_828)], TARGET, NOW)!;
    const r = deriveRealtime(snap(NOW, 297_666), anchor);
    expect(r.windowHours).toBe(61);
    expect(r.windowExact).toBe(false);
    // Still available — the UI relabels it "last 61 hours" rather than hiding it.
    expect(r.views48hAvailable).toBe(true);
  });

  it('never reports a negative view count even when the counter was swept', () => {
    const anchor = pickAnchor([snap('2026-07-26T12:00:00Z', 300_000)], TARGET, NOW)!;
    const r = deriveRealtime(snap(NOW, 297_666), anchor);
    expect(r.views48h).toBe(0);
    expect(r.viewCountDecreased).toBe(true);
  });

  it('never claims an exact subscriber count it cannot derive', () => {
    const r = deriveRealtime(snap(NOW, 297_666), null);
    expect(r.subscribersExact).toBeNull();
  });

  it('suppresses the delta if the anchor is somehow newer than the latest snapshot', () => {
    const anchor = pickAnchor([snap('2026-07-29T12:00:00Z', 999)], TARGET, NOW)!;
    const r = deriveRealtime(snap(NOW, 297_666), anchor);
    expect(r.views48hAvailable).toBe(false);
  });
});
