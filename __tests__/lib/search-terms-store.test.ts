/** @jest-environment node */
/**
 * Tests for the search-terms snapshot store: pure trend diffing + the
 * capture/read paths (DynamoDB + fetchSearchTerms mocked at the boundary).
 */

import {
  computeSearchTermsTrend,
  captureSearchTermsSnapshot,
  readRecentSnapshots,
  type SearchTermsSnapshot,
} from '@/lib/search-terms-store';

const mockFetch = jest.fn();
jest.mock('@/lib/youtube-analytics', () => ({ fetchSearchTerms: (...a: unknown[]) => mockFetch(...a) }));

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
  mockPut.mockReset();
  mockQuery.mockReset();
});

describe('computeSearchTermsTrend', () => {
  it('flags new terms (null deltas) and diffs existing ones by views + rank', () => {
    const previous: SearchTermsSnapshot = {
      scope: 'CHANNEL',
      date: '2026-07-09',
      capturedAt: 'x',
      terms: [
        { term: 'a', views: 10, estimatedMinutesWatched: 0 }, // rank 1
        { term: 'b', views: 8, estimatedMinutesWatched: 0 }, // rank 2
      ],
    };
    const current = [
      { term: 'b', views: 20, estimatedMinutesWatched: 0 }, // 2 -> 1 (up), +12 views
      { term: 'c', views: 5, estimatedMinutesWatched: 0 }, // new
      { term: 'a', views: 12, estimatedMinutesWatched: 0 }, // 1 -> 3 (down), +2 views
    ];
    const trend = computeSearchTermsTrend(current, previous);

    expect(trend.map((t) => t.term)).toEqual(['b', 'c', 'a']); // current order = rank order
    expect(trend[0]).toMatchObject({ term: 'b', rank: 1, viewsDelta: 12, rankDelta: 1, isNew: false });
    expect(trend[1]).toMatchObject({ term: 'c', rank: 2, viewsDelta: null, rankDelta: null, isNew: true });
    expect(trend[2]).toMatchObject({ term: 'a', rank: 3, viewsDelta: 2, rankDelta: -2, isNew: false });
  });

  it('treats everything as new when there is no previous snapshot', () => {
    const trend = computeSearchTermsTrend([{ term: 'x', views: 3, estimatedMinutesWatched: 0 }], null);
    expect(trend[0]).toMatchObject({ isNew: true, viewsDelta: null, rankDelta: null, rank: 1 });
  });
});

describe('captureSearchTermsSnapshot', () => {
  it('persists a dated channel-scope snapshot and returns it', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      data: [{ term: 'tamil grief song', views: 9, estimatedMinutesWatched: 40 }],
    });
    const res = await captureSearchTermsSnapshot({ days: 28, date: '2026-07-10' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.scope).toBe('CHANNEL');
      expect(res.data.date).toBe('2026-07-10');
    }
    expect(mockFetch).toHaveBeenCalledWith(undefined, 28);
    const item = mockPut.mock.calls[0][0];
    expect(item.PK).toBe('SEARCHSNAP#CHANNEL');
    expect(item.SK).toBe('2026-07-10');
    expect(item.terms).toHaveLength(1);
  });

  it('scopes to the videoId when given', async () => {
    mockFetch.mockResolvedValue({ ok: true, data: [] });
    await captureSearchTermsSnapshot({ videoId: 'kOpNZHlE9FE', date: '2026-07-10' });
    expect(mockFetch).toHaveBeenCalledWith('kOpNZHlE9FE', 28);
    expect(mockPut.mock.calls[0][0].PK).toBe('SEARCHSNAP#kOpNZHlE9FE');
  });

  it('propagates a fetch failure without writing', async () => {
    mockFetch.mockResolvedValue({ ok: false, error: 'boom' });
    const res = await captureSearchTermsSnapshot({});
    expect(res.ok).toBe(false);
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('readRecentSnapshots', () => {
  it('queries the scope partition newest-first and maps items', async () => {
    mockQuery.mockResolvedValue({
      Items: [
        {
          scope: 'CHANNEL',
          date: '2026-07-10',
          terms: [{ term: 'a', views: 1, estimatedMinutesWatched: 0 }],
          capturedAt: 't',
        },
      ],
    });
    const out = await readRecentSnapshots('CHANNEL', 5);
    const params = mockQuery.mock.calls[0][0];
    expect(params.expressionAttributeValues[':pk']).toBe('SEARCHSNAP#CHANNEL');
    expect(params.scanIndexForward).toBe(false);
    expect(params.limit).toBe(5);
    expect(out[0].date).toBe('2026-07-10');
    expect(out[0].terms).toHaveLength(1);
  });
});
