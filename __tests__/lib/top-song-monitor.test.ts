/** @jest-environment node */
import {
  diagnoseSong,
  buildTopSongMonitor,
  logImpressions,
  readLatestImpressions,
  type SongMetrics,
} from '@/lib/top-song-monitor';
import type { TopVideoRow } from '@/lib/youtube-analytics';

const mockPut = jest.fn();
const mockQuery = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: (...a: unknown[]) => mockPut(...a), query: (...a: unknown[]) => mockQuery(...a) },
}));

beforeEach(() => {
  mockPut.mockReset();
  mockQuery.mockReset();
});

const m = (views: number, avd: number, impr: number | null = null, ctr: number | null = null): SongMetrics => ({
  views,
  avgViewDuration: avd,
  impressions: impr,
  ctr,
});

describe('diagnoseSong (the decision tree)', () => {
  it('stable when views are not materially down', () => {
    expect(diagnoseSong(m(95, 100), m(100, 100))).toBe('stable');
  });
  it('satisfaction when views down AND watch-time down', () => {
    expect(diagnoseSong(m(50, 60), m(100, 100))).toBe('satisfaction');
  });
  it('ctr when views down, watch stable, and CTR down (both logged)', () => {
    expect(diagnoseSong(m(50, 100, 1000, 3), m(100, 100, 1000, 6))).toBe('ctr');
  });
  it('distribution when views down but engagement stable (incl. impressions↓, CTR stable)', () => {
    expect(diagnoseSong(m(50, 100), m(100, 100))).toBe('distribution');
    expect(diagnoseSong(m(50, 100, 800, 6), m(100, 100, 2000, 6))).toBe('distribution');
  });
  it('insufficient with no prior views', () => {
    expect(diagnoseSong(m(50, 100), m(0, 0))).toBe('insufficient');
  });
});

describe('buildTopSongMonitor', () => {
  const recent: TopVideoRow[] = [
    { videoId: 'a', views: 500, averageViewDuration: 100 },
    { videoId: 'b', views: 300, averageViewDuration: 60 },
  ];
  const prior: TopVideoRow[] = [
    { videoId: 'a', views: 1000, averageViewDuration: 100 }, // views halved, watch stable → distribution
    { videoId: 'b', views: 320, averageViewDuration: 120 }, // views ~flat → stable
  ];

  it('ranks by recent views, computes deltas + diagnosis, merges logged impressions', () => {
    const titles = new Map([['a', 'Song A'], ['b', 'Song B']]);
    const imp = new Map([['a', { impressions: 9000, ctr: 5.5 }]]);
    const rows = buildTopSongMonitor(recent, prior, titles, imp);
    expect(rows[0]).toMatchObject({
      videoId: 'a',
      title: 'Song A',
      views: 500,
      viewsDeltaPct: -50,
      diagnosis: 'distribution',
      impressions: 9000,
      ctr: 5.5,
    });
    expect(rows[1]).toMatchObject({ videoId: 'b', diagnosis: 'stable', impressions: null });
  });

  it('marks a song insufficient when it has no prior window', () => {
    const rows = buildTopSongMonitor([{ videoId: 'x', views: 10, averageViewDuration: 50 }], [], new Map(), new Map());
    expect(rows[0].diagnosis).toBe('insufficient');
    expect(rows[0].viewsDeltaPct).toBeNull();
  });
});

describe('impressions store', () => {
  it('logImpressions writes PK=IMPRESS, SK=<checkedAt>#<videoId>', async () => {
    await logImpressions({ videoId: 'a', impressions: 9000, ctr: 5.5, checkedAt: '2026-07-11T00:00:00Z' });
    const item = mockPut.mock.calls[0][0];
    expect(item.PK).toBe('IMPRESS');
    expect(item.SK).toBe('2026-07-11T00:00:00Z#a');
  });

  it('readLatestImpressions keeps the newest entry per video', async () => {
    mockQuery.mockResolvedValue({
      Items: [
        { videoId: 'a', impressions: 9000, ctr: 5.5, checkedAt: '2026-07-11' },
        { videoId: 'a', impressions: 1, ctr: 1, checkedAt: '2026-07-01' },
      ],
    });
    const map = await readLatestImpressions();
    expect(map.get('a')).toEqual({ impressions: 9000, ctr: 5.5 });
    expect(mockQuery.mock.calls[0][0].scanIndexForward).toBe(false);
  });
});
