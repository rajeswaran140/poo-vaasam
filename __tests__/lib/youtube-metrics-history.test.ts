/** @jest-environment node */
/**
 * Tests for the daily metrics history store — capture (idempotent upsert +
 * backfill), the not-configured passthrough, and the oldest→newest read the
 * stats layer depends on. fetchDailySeries + DynamoDB are mocked at the boundary.
 */

import { captureChannelMetrics, readChannelMetricSeries } from '@/lib/youtube-metrics-history';

const mockFetch = jest.fn();
jest.mock('@/lib/youtube-analytics', () => ({ fetchDailySeries: (...a: unknown[]) => mockFetch(...a) }));

const mockPut = jest.fn();
const mockQuery = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: (...a: unknown[]) => mockPut(...a),
    query: (...a: unknown[]) => mockQuery(...a),
  },
}));

beforeEach(() => {
  mockFetch.mockReset();
  mockPut.mockReset().mockResolvedValue(undefined);
  mockQuery.mockReset();
});

const SERIES = [
  { date: '2026-07-08', views: 10, subscribersGained: 2, estimatedMinutesWatched: 30 },
  { date: '2026-07-09', views: 12, subscribersGained: 3, estimatedMinutesWatched: 41 },
];

describe('captureChannelMetrics', () => {
  it('upserts one dated point per day and reports the captured range', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, data: SERIES });
    const res = await captureChannelMetrics({ daysBack: 2 });

    expect(res).toEqual({ ok: true, data: { scope: 'CHANNEL', daysCaptured: 2, from: '2026-07-08', to: '2026-07-09' } });
    expect(mockPut).toHaveBeenCalledTimes(2);
    expect(mockPut).toHaveBeenCalledWith(
      expect.objectContaining({ PK: 'METRICSNAP#CHANNEL', SK: '2026-07-09', date: '2026-07-09', views: 12, subscribersGained: 3, estimatedMinutesWatched: 41 })
    );
    // provenance stamp is present
    expect(mockPut.mock.calls[0][0]).toHaveProperty('capturedAt');
  });

  it('propagates a not-configured / upstream failure without writing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, error: 'YouTube Analytics OAuth not configured' });
    const res = await captureChannelMetrics({ daysBack: 3 });
    expect(res).toEqual({ ok: false, error: 'YouTube Analytics OAuth not configured' });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('clamps daysBack into [1, 400] (backfill guard)', async () => {
    mockFetch.mockResolvedValue({ ok: true, data: [] });
    await captureChannelMetrics({ daysBack: 0 });
    await captureChannelMetrics({ daysBack: 9999 });
    expect(mockFetch).toHaveBeenNthCalledWith(1, 1);
    expect(mockFetch).toHaveBeenNthCalledWith(2, 400);
  });
});

describe('readChannelMetricSeries', () => {
  it('returns points oldest→newest even though Dynamo yields newest-first', async () => {
    mockQuery.mockResolvedValueOnce({
      Items: [
        { SK: '2026-07-09', date: '2026-07-09', views: 12, subscribersGained: 3, estimatedMinutesWatched: 41, capturedAt: 'x' },
        { SK: '2026-07-08', date: '2026-07-08', views: 10, subscribersGained: 2, estimatedMinutesWatched: 30, capturedAt: 'x' },
      ],
    });
    const series = await readChannelMetricSeries(180);

    expect(series.map((p) => p.date)).toEqual(['2026-07-08', '2026-07-09']);
    expect(series[1]).toMatchObject({ views: 12, subscribersGained: 3 });
    const q = mockQuery.mock.calls[0][0];
    expect(q).toMatchObject({ scanIndexForward: false, limit: 180 });
    expect(q.expressionAttributeValues).toEqual({ ':pk': 'METRICSNAP#CHANNEL' });
  });
});
