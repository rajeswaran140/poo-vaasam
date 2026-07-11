/** @jest-environment node */
import { buildScorecard, logObservation, readLatestObservations } from '@/lib/search-observation-store';
import type { SongQuerySet } from '@/config/song-search-queries';

const mockPut = jest.fn();
const mockQuery = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: (...a: unknown[]) => mockPut(...a), query: (...a: unknown[]) => mockQuery(...a) },
}));

beforeEach(() => {
  mockPut.mockReset();
  mockQuery.mockReset();
});

const set: SongQuerySet = {
  videoId: 'v',
  label: 'L',
  queries: [
    { query: 'a', intent: 'father_loss', conversion: 'high' }, // ceiling 1.0
    { query: 'b', intent: 'discovery', conversion: 'low' }, // ceiling 0.15
  ],
};

describe('buildScorecard', () => {
  it('scores unobserved queries as the full gap, biggest-gap first', () => {
    const rows = buildScorecard(set, new Map());
    expect(rows[0]).toMatchObject({ query: 'a', position: null, opportunity: 0, gap: 1 });
    expect(rows[1]).toMatchObject({ query: 'b', gap: 0.15 });
  });

  it('reflects a logged position — opportunity up, gap down, re-sorted', () => {
    const latest = new Map([['a', { videoId: 'v', query: 'a', position: 1, checkedAt: 't' }]]);
    const rows = buildScorecard(set, latest);
    const a = rows.find((r) => r.query === 'a')!;
    expect(a.position).toBe(1);
    expect(a.opportunity).toBeCloseTo(1);
    expect(a.gap).toBeCloseTo(0);
    // 'a' is now fully captured (gap 0), so unrealized 'b' (gap 0.15) sorts first.
    expect(rows[0].query).toBe('b');
  });
});

describe('logObservation', () => {
  it('writes PK=SEARCHOBS#<videoId>, SK=<checkedAt>#<query>', async () => {
    await logObservation({ videoId: 'v', query: 'a', position: 2, checkedAt: '2026-07-10T00:00:00Z' });
    const item = mockPut.mock.calls[0][0];
    expect(item.PK).toBe('SEARCHOBS#v');
    expect(item.SK).toBe('2026-07-10T00:00:00Z#a');
    expect(item.position).toBe(2);
  });
});

describe('readLatestObservations', () => {
  it('keeps the newest observation per query (query newest-first)', async () => {
    mockQuery.mockResolvedValue({
      Items: [
        { query: 'a', position: 1, checkedAt: '2026-07-10' }, // newest a
        { query: 'a', position: 5, checkedAt: '2026-07-09' }, // older a — ignored
        { query: 'b', position: 3, checkedAt: '2026-07-08' },
      ],
    });
    const latest = await readLatestObservations('v');
    expect(latest.get('a')!.position).toBe(1);
    expect(latest.get('b')!.position).toBe(3);
    expect(mockQuery.mock.calls[0][0].scanIndexForward).toBe(false);
    expect(mockQuery.mock.calls[0][0].expressionAttributeValues[':pk']).toBe('SEARCHOBS#v');
  });
});
