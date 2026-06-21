import {
  toSubscriber,
  isoDay,
  filterByDateRange,
  filterByStatus,
  dailyCounts,
  summarize,
  sortByJoinedDesc,
  type SubscriberRecord,
} from '@/lib/subscribers';

const sub = (over: Partial<SubscriberRecord>): SubscriberRecord => ({
  email: 'a@b.com',
  source: 'site',
  status: 'SUBSCRIBED',
  createdAt: '2026-06-10T08:00:00.000Z',
  ...over,
});

describe('toSubscriber', () => {
  it('coerces a raw item and defaults status to SUBSCRIBED', () => {
    expect(toSubscriber({ email: 'x@y.com', createdAt: '2026-06-01T00:00:00Z' })).toEqual({
      email: 'x@y.com',
      source: 'site',
      status: 'SUBSCRIBED',
      createdAt: '2026-06-01T00:00:00Z',
      unsubscribedAt: undefined,
    });
  });
  it('reads UNSUBSCRIBED + unsubscribedAt', () => {
    const s = toSubscriber({ email: 'x@y.com', status: 'UNSUBSCRIBED', unsubscribedAt: '2026-06-15T00:00:00Z', createdAt: '2026-06-01T00:00:00Z' });
    expect(s.status).toBe('UNSUBSCRIBED');
    expect(s.unsubscribedAt).toBe('2026-06-15T00:00:00Z');
  });
});

describe('isoDay', () => {
  it('extracts the YYYY-MM-DD day', () => {
    expect(isoDay('2026-06-10T08:00:00.000Z')).toBe('2026-06-10');
    expect(isoDay('2026-06-10')).toBe('2026-06-10');
    expect(isoDay(undefined)).toBe('');
  });
});

describe('filterByDateRange', () => {
  const subs = [
    sub({ email: 'early@x.com', createdAt: '2026-06-01T10:00:00Z' }),
    sub({ email: 'mid@x.com', createdAt: '2026-06-10T10:00:00Z' }),
    sub({ email: 'late@x.com', createdAt: '2026-06-20T10:00:00Z' }),
  ];
  it('returns all when no bounds given', () => {
    expect(filterByDateRange(subs)).toHaveLength(3);
  });
  it('filters inclusive on both bounds', () => {
    const r = filterByDateRange(subs, '2026-06-05', '2026-06-15');
    expect(r.map((s) => s.email)).toEqual(['mid@x.com']);
  });
  it('includes a join exactly on the boundary day', () => {
    expect(filterByDateRange(subs, '2026-06-20', '2026-06-20').map((s) => s.email)).toEqual(['late@x.com']);
  });
  it('supports an open-ended from', () => {
    expect(filterByDateRange(subs, '2026-06-10').map((s) => s.email)).toEqual(['mid@x.com', 'late@x.com']);
  });
});

describe('filterByStatus', () => {
  const subs = [sub({ email: 's@x.com' }), sub({ email: 'u@x.com', status: 'UNSUBSCRIBED' })];
  it('all → unchanged', () => expect(filterByStatus(subs, 'all')).toHaveLength(2));
  it('subscribed only', () => expect(filterByStatus(subs, 'subscribed').map((s) => s.email)).toEqual(['s@x.com']));
  it('unsubscribed only', () => expect(filterByStatus(subs, 'unsubscribed').map((s) => s.email)).toEqual(['u@x.com']));
});

describe('dailyCounts', () => {
  it('buckets signups by createdAt and unsubscribes by unsubscribedAt', () => {
    const subs = [
      sub({ email: 'a@x.com', createdAt: '2026-06-10T01:00:00Z' }),
      sub({ email: 'b@x.com', createdAt: '2026-06-10T05:00:00Z' }),
      sub({ email: 'c@x.com', createdAt: '2026-06-11T05:00:00Z', status: 'UNSUBSCRIBED', unsubscribedAt: '2026-06-12T00:00:00Z' }),
    ];
    expect(dailyCounts(subs)).toEqual([
      { date: '2026-06-10', signups: 2, unsubscribes: 0 },
      { date: '2026-06-11', signups: 1, unsubscribes: 0 },
      { date: '2026-06-12', signups: 0, unsubscribes: 1 },
    ]);
  });
  it('does not count unsubscribes for still-subscribed records', () => {
    const subs = [sub({ createdAt: '2026-06-10T00:00:00Z', unsubscribedAt: '2026-06-11T00:00:00Z', status: 'SUBSCRIBED' })];
    expect(dailyCounts(subs)).toEqual([{ date: '2026-06-10', signups: 1, unsubscribes: 0 }]);
  });
});

describe('summarize', () => {
  it('counts by status', () => {
    const subs = [sub({}), sub({ status: 'UNSUBSCRIBED' }), sub({})];
    expect(summarize(subs)).toEqual({ subscribed: 2, unsubscribed: 1, total: 3 });
  });
});

describe('sortByJoinedDesc', () => {
  it('newest first', () => {
    const subs = [
      sub({ email: 'old@x.com', createdAt: '2026-06-01T00:00:00Z' }),
      sub({ email: 'new@x.com', createdAt: '2026-06-20T00:00:00Z' }),
    ];
    expect(sortByJoinedDesc(subs).map((s) => s.email)).toEqual(['new@x.com', 'old@x.com']);
  });
});
