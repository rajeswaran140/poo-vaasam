/** @jest-environment node */
/**
 * Recording the upload → premiere gap.
 *
 * The one thing that makes this module worth having is that it refuses to
 * record an AIRED premiere. YouTube overwrites `publishedAt` with the premiere
 * time once a premiere starts, so recording one would store a gap of ~0 — the
 * exact false measurement the module exists to prevent, and it would look
 * perfectly plausible in the data.
 *
 * The report half is tested for the opposite failure: concluding from too
 * little. The 48-hour rule became "fact" on a single case, and the point of
 * collecting data is to stop doing that.
 */
import {
  observe,
  gapHours,
  report,
  ASSERTED_GAP_LIMIT_HOURS,
  type UpcomingSnapshot,
  type PremiereObservation,
  type LaunchResult,
} from '@/lib/premiere-observation';

const upcoming = (over: Partial<UpcomingSnapshot> = {}): UpcomingSnapshot => ({
  videoId: 'abc',
  title: 'ஒரு பாடல்',
  publishedAt: '2026-09-20T12:00:00Z',
  scheduledStartTime: '2026-09-22T12:00:00Z',
  liveBroadcastContent: 'upcoming',
  ...over,
});

const NOW = new Date('2026-09-20T13:00:00Z');

describe('the gap', () => {
  it('is hours between upload and the scheduled premiere', () => {
    expect(gapHours('2026-09-20T12:00:00Z', '2026-09-22T12:00:00Z')).toBe(48);
    expect(gapHours('2026-09-13T20:23:00Z', '2026-09-23T11:47:00Z')).toBe(231.4);
  });

  it('is null rather than NaN when a timestamp is unreadable', () => {
    expect(gapHours('not-a-date', '2026-09-22T12:00:00Z')).toBeNull();
    expect(gapHours('2026-09-20T12:00:00Z', '')).toBeNull();
  });
});

describe('what may be recorded', () => {
  it('records an unaired premiere', () => {
    expect(observe(upcoming(), NOW)).toEqual({
      videoId: 'abc',
      title: 'ஒரு பாடல்',
      uploadedAt: '2026-09-20T12:00:00Z',
      scheduledStartTime: '2026-09-22T12:00:00Z',
      gapHours: 48,
      recordedAt: '2026-09-20T13:00:00.000Z',
    });
  });

  /**
   * ⚠️ THE ONE THAT MATTERS. On an aired premiere `publishedAt` IS the premiere
   * time, so this would record gapHours ≈ 0 — a false reading that looks real.
   */
  it('REFUSES a premiere that has already aired', () => {
    expect(observe(upcoming({ liveBroadcastContent: 'none' }), NOW)).toBeNull();
    expect(observe(upcoming({ liveBroadcastContent: 'live' }), NOW)).toBeNull();
  });

  it('refuses an ordinary upload with no premiere at all', () => {
    expect(observe(upcoming({ liveBroadcastContent: 'none', scheduledStartTime: undefined }), NOW)).toBeNull();
  });

  it('refuses when the schedule is missing', () => {
    expect(observe(upcoming({ scheduledStartTime: undefined }), NOW)).toBeNull();
  });

  /** A premiere before its own upload means the fields are not what we think. */
  it('refuses a negative gap rather than storing it', () => {
    expect(observe(upcoming({ scheduledStartTime: '2026-09-19T12:00:00Z' }), NOW)).toBeNull();
  });
});

describe('the report refuses to conclude early', () => {
  const at = (gapHours: number, day0Views: number): LaunchResult => ({
    observation: {
      videoId: 'v', title: 't', uploadedAt: '2026-09-01T00:00:00Z',
      scheduledStartTime: '2026-09-02T00:00:00Z', gapHours, recordedAt: '2026-09-01T00:00:00Z',
    } as PremiereObservation,
    day0Views,
  });

  it('says "not enough data" on two anecdotes — which is how the rule started', () => {
    const r = report([at(71.6, 2), at(69.5, 46)]);
    expect(r.verdict).toMatch(/Not enough data/);
  });

  it('still refuses when only one side is populated', () => {
    expect(report([...Array(8)].map(() => at(12, 500))).verdict).toMatch(/Not enough data/);
  });

  it('supports the rule when short gaps really do launch bigger', () => {
    const r = report([
      ...[10, 20, 30, 40, 12].map((g) => at(g, 1000)),
      ...[60, 80, 100, 120, 200].map((g) => at(g, 200)),
    ]);
    expect(r.verdict).toMatch(/^Supports the rule/);
    expect(r.medianUnder).toBe(1000);
    expect(r.medianOver).toBe(200);
  });

  it('says so plainly when the data CONTRADICTS the rule', () => {
    const r = report([
      ...[10, 20, 30, 40, 12].map((g) => at(g, 100)),
      ...[60, 80, 100, 120, 200].map((g) => at(g, 900)),
    ]);
    expect(r.verdict).toMatch(/CONTRADICTS/);
  });

  it('says the gap is not the lever when both sides look the same', () => {
    const r = report([
      ...[10, 20, 30, 40, 12].map((g) => at(g, 500)),
      ...[60, 80, 100, 120, 200].map((g) => at(g, 520)),
    ]);
    expect(r.verdict).toMatch(/not the lever/);
  });

  it('ignores launches with no view data rather than counting them as zero', () => {
    const r = report([at(10, 500), { ...at(10, 0), day0Views: null }]);
    expect(r.under).toEqual([500]);
  });

  it('uses the threshold the checklist asserts', () => {
    expect(ASSERTED_GAP_LIMIT_HOURS).toBe(48);
  });
});
