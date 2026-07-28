import {
  quotaSortKey,
  defaultLimitFor,
  consumeQuota,
  DEFAULT_ANALYTICS_QUOTA_LIMIT,
  FAILOPEN_CONTAINER_CEILING,
  __resetDegradedQuotaForTests,
  quotaDayKey,
  evaluateQuota,
  QUOTA_COST,
  DEFAULT_QUOTA_LIMIT,
  DEFAULT_WARN_THRESHOLD,
} from '@/lib/youtube-quota';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

describe('quotaDayKey (Pacific, because Google resets quota at midnight PT)', () => {
  it('uses the Pacific day, not UTC', () => {
    // 2026-07-28T06:00Z is still 2026-07-27 23:00 in Los Angeles.
    expect(quotaDayKey(new Date('2026-07-28T06:00:00Z'))).toBe('2026-07-27');
  });

  it('rolls over exactly at Pacific midnight', () => {
    // PDT = UTC-7 in July, so 07:00Z is 00:00 PT.
    expect(quotaDayKey(new Date('2026-07-28T06:59:00Z'))).toBe('2026-07-27');
    expect(quotaDayKey(new Date('2026-07-28T07:00:00Z'))).toBe('2026-07-28');
  });

  it('honours the DST offset difference between summer and winter', () => {
    // PST = UTC-8 in January, so the boundary moves an hour later in UTC.
    expect(quotaDayKey(new Date('2026-01-15T07:59:00Z'))).toBe('2026-01-14');
    expect(quotaDayKey(new Date('2026-01-15T08:00:00Z'))).toBe('2026-01-15');
  });

  it('does not use the Toronto day either (the app\'s own timezone)', () => {
    // 2026-07-28T05:00Z = 01:00 Toronto (already the 28th) but 22:00 PT on the 27th.
    expect(quotaDayKey(new Date('2026-07-28T05:00:00Z'))).toBe('2026-07-27');
  });
});

describe('evaluateQuota', () => {
  const day = '2026-07-28';

  it('allows a spend well under the threshold', () => {
    const q = evaluateQuota(288, day);
    expect(q.blocked).toBe(false);
    expect(q.warn).toBe(false);
    expect(q.remaining).toBe(DEFAULT_QUOTA_LIMIT - 288);
    expect(q.fraction).toBeCloseTo(0.0288, 4);
  });

  it('blocks at exactly the 80% threshold, not just past it', () => {
    const q = evaluateQuota(8000, day);
    expect(q.fraction).toBeCloseTo(DEFAULT_WARN_THRESHOLD, 6);
    expect(q.blocked).toBe(true);
    expect(q.warn).toBe(true);
  });

  it('stays blocked once over budget and never reports negative remaining', () => {
    const q = evaluateQuota(12_000, day);
    expect(q.blocked).toBe(true);
    expect(q.remaining).toBe(0);
  });

  it('treats a zero limit as no budget rather than unlimited', () => {
    const q = evaluateQuota(0, day, 0);
    expect(q.blocked).toBe(true);
    expect(q.fraction).toBe(1);
  });

  it('coerces nonsense usage to zero instead of propagating NaN', () => {
    const q = evaluateQuota(Number.NaN, day);
    expect(q.used).toBe(0);
    expect(q.blocked).toBe(false);
  });

  it('respects a custom threshold', () => {
    expect(evaluateQuota(5000, day, 10_000, 0.5).blocked).toBe(true);
    expect(evaluateQuota(4999, day, 10_000, 0.5).blocked).toBe(false);
  });

  it('carries the day through so callers can log which budget was hit', () => {
    expect(evaluateQuota(1, day).day).toBe(day);
  });
});

describe('QUOTA_COST', () => {
  it('prices the cheap calls at 1 unit', () => {
    expect(QUOTA_COST.channelsList).toBe(1);
    expect(QUOTA_COST.videosList).toBe(1);
    expect(QUOTA_COST.playlistItemsList).toBe(1);
  });

  it('records why search.list is banned: 100x the cost of the alternatives', () => {
    expect(QUOTA_COST.searchList).toBe(100);
    expect(QUOTA_COST.searchList).toBe(100 * QUOTA_COST.videosList);
  });

  it('keeps a 5-minute channels.list poll inside budget for a full day', () => {
    const pollsPerDay = (24 * 60) / 5; // 288
    expect(pollsPerDay * QUOTA_COST.channelsList).toBe(288);
    expect(evaluateQuota(288, '2026-07-28').blocked).toBe(false);
  });
});

describe('quotaSortKey (Data and Analytics are metered separately)', () => {
  it('gives each surface its own counter row', () => {
    expect(quotaSortKey('data')).toBe('COUNTER#DATA');
    expect(quotaSortKey('analytics')).toBe('COUNTER#ANALYTICS');
    expect(quotaSortKey('data')).not.toBe(quotaSortKey('analytics'));
  });

  it('defaults each surface to its own limit', () => {
    expect(defaultLimitFor('data')).toBe(DEFAULT_QUOTA_LIMIT);
    expect(defaultLimitFor('analytics')).toBe(DEFAULT_ANALYTICS_QUOTA_LIMIT);
  });

  it('does not let one surface\'s spend affect the other\'s verdict', () => {
    // 9,000 units on Data must not block Analytics, which has its own budget.
    const data = evaluateQuota(9000, '2026-07-28', DEFAULT_QUOTA_LIMIT, 0.8, 'data');
    const analytics = evaluateQuota(10, '2026-07-28', DEFAULT_ANALYTICS_QUOTA_LIMIT, 0.8, 'analytics');
    expect(data.blocked).toBe(true);
    expect(analytics.blocked).toBe(false);
    expect(analytics.surface).toBe('analytics');
  });
});

describe('bounded fail-open backstop', () => {
  beforeEach(() => {
    __resetDegradedQuotaForTests();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('allows a transient blip through without blocking', async () => {
    jest
      .spyOn(DynamoDBOperations, 'update')
      .mockRejectedValue(new Error('ProvisionedThroughputExceeded'));
    const q = await consumeQuota(1, { now: new Date('2026-07-28T18:00:00Z') });
    expect(q.blocked).toBe(false);
    expect(q.degraded).toBe(true);
  });

  it('stops a runaway loop on a single container once the ceiling is hit', async () => {
    jest.spyOn(DynamoDBOperations, 'update').mockRejectedValue(new Error('ledger down'));
    const now = new Date('2026-07-28T18:00:00Z');
    let last = await consumeQuota(1, { now });
    for (let i = 0; i < 60 && !last.blocked; i++) last = await consumeQuota(1, { now });
    expect(last.blocked).toBe(true);
    expect(last.degraded).toBe(true);
    // Blocked well before the daily budget — the backstop, not the real limit.
    expect(last.used).toBeLessThanOrEqual(FAILOPEN_CONTAINER_CEILING);
  });

  it('keeps degraded spend separate per surface', async () => {
    jest.spyOn(DynamoDBOperations, 'update').mockRejectedValue(new Error('ledger down'));
    const now = new Date('2026-07-28T18:00:00Z');
    for (let i = 0; i < 45; i++) await consumeQuota(1, { now, surface: 'data' });
    const analytics = await consumeQuota(1, { now, surface: 'analytics' });
    expect(analytics.blocked).toBe(false);
    expect(analytics.used).toBe(1);
  });

  it('marks a healthy ledger verdict as NOT degraded', async () => {
    jest.spyOn(DynamoDBOperations, 'update').mockResolvedValue({ used: 42 } as never);
    const q = await consumeQuota(1, { now: new Date('2026-07-28T18:00:00Z') });
    expect(q.degraded).toBe(false);
    expect(q.used).toBe(42);
    expect(q.blocked).toBe(false);
  });
});

describe('Analytics placeholder must not self-inflict an outage', () => {
  // The daily sync issues 3 reports.query calls against the Analytics surface.
  // A placeholder conservative enough to trip on those would take the sync down
  // before anyone confirms the real ceiling in the Cloud console.
  const DAILY_SYNC_ANALYTICS_QUERIES = 3;

  it('clears the daily sync with room to spare', () => {
    const q = evaluateQuota(
      DAILY_SYNC_ANALYTICS_QUERIES,
      '2026-07-28',
      DEFAULT_ANALYTICS_QUOTA_LIMIT,
      DEFAULT_WARN_THRESHOLD,
      'analytics'
    );
    expect(q.blocked).toBe(false);
  });

  it('leaves at least two orders of magnitude of headroom over the sync', () => {
    const usableBudget = DEFAULT_ANALYTICS_QUOTA_LIMIT * DEFAULT_WARN_THRESHOLD;
    expect(usableBudget).toBeGreaterThan(DAILY_SYNC_ANALYTICS_QUERIES * 100);
  });

  it('still blocks a genuine runaway on the analytics surface', () => {
    const q = evaluateQuota(
      DEFAULT_ANALYTICS_QUOTA_LIMIT,
      '2026-07-28',
      DEFAULT_ANALYTICS_QUOTA_LIMIT,
      DEFAULT_WARN_THRESHOLD,
      'analytics'
    );
    expect(q.blocked).toBe(true);
  });
});
