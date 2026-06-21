/**
 * Subscriber-list helpers — pure projection + filtering over the email
 * newsletter records (DynamoDB PK=SUBSCRIBER#<email>, SK=METADATA). Kept
 * framework/DB-free so the admin route stays thin and the date-range,
 * status-filter and daily-count logic are unit-testable without DynamoDB.
 */

export type SubscriberStatus = 'SUBSCRIBED' | 'UNSUBSCRIBED';

export interface SubscriberRecord {
  email: string;
  source: string;
  status: SubscriberStatus;
  /** ISO-8601 — when they joined. */
  createdAt: string;
  /** ISO-8601 — set when an admin processes an unsubscribe. */
  unsubscribedAt?: string;
}

/** List-view status selector. */
export type StatusFilter = 'all' | 'subscribed' | 'unsubscribed';

/** Defensively coerce a raw DynamoDB item into a SubscriberRecord. */
export function toSubscriber(item: Record<string, unknown>): SubscriberRecord {
  return {
    email: String(item.email ?? ''),
    source: String(item.source ?? 'site'),
    status: item.status === 'UNSUBSCRIBED' ? 'UNSUBSCRIBED' : 'SUBSCRIBED',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    unsubscribedAt: typeof item.unsubscribedAt === 'string' ? item.unsubscribedAt : undefined,
  };
}

/** The YYYY-MM-DD day (UTC) of an ISO timestamp, or '' when unparseable. */
export function isoDay(ts: string | undefined): string {
  if (!ts) return '';
  const i = ts.indexOf('T');
  return i > 0 ? ts.slice(0, i) : ts.slice(0, 10);
}

/**
 * Keep subscribers whose JOIN day (createdAt) falls within [from, to] inclusive.
 * `from`/`to` are YYYY-MM-DD; either may be omitted for an open-ended bound.
 * Lexical comparison is valid because ISO day strings sort chronologically.
 */
export function filterByDateRange(
  subs: SubscriberRecord[],
  from?: string,
  to?: string
): SubscriberRecord[] {
  if (!from && !to) return subs;
  return subs.filter((s) => {
    const day = isoDay(s.createdAt);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

/** Keep subscribers matching the status filter. */
export function filterByStatus(subs: SubscriberRecord[], filter: StatusFilter): SubscriberRecord[] {
  if (filter === 'all') return subs;
  const want: SubscriberStatus = filter === 'unsubscribed' ? 'UNSUBSCRIBED' : 'SUBSCRIBED';
  return subs.filter((s) => s.status === want);
}

export interface DailyCount {
  date: string; // YYYY-MM-DD
  signups: number; // joined that day (createdAt)
  unsubscribes: number; // unsubscribed that day (unsubscribedAt)
}

/**
 * Per-day signup vs unsubscribe counts, ascending by date. Signups bucket by
 * createdAt; unsubscribes by unsubscribedAt. Days with neither are omitted.
 */
export function dailyCounts(subs: SubscriberRecord[]): DailyCount[] {
  const map = new Map<string, DailyCount>();
  const bump = (date: string, key: 'signups' | 'unsubscribes') => {
    if (!date) return;
    const row = map.get(date) ?? { date, signups: 0, unsubscribes: 0 };
    row[key] += 1;
    map.set(date, row);
  };
  for (const s of subs) {
    bump(isoDay(s.createdAt), 'signups');
    if (s.status === 'UNSUBSCRIBED') bump(isoDay(s.unsubscribedAt), 'unsubscribes');
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Totals for the summary cards. */
export function summarize(subs: SubscriberRecord[]): {
  subscribed: number;
  unsubscribed: number;
  total: number;
} {
  let subscribed = 0;
  let unsubscribed = 0;
  for (const s of subs) {
    if (s.status === 'UNSUBSCRIBED') unsubscribed += 1;
    else subscribed += 1;
  }
  return { subscribed, unsubscribed, total: subs.length };
}

/** Newest-first by join date. */
export function sortByJoinedDesc(subs: SubscriberRecord[]): SubscriberRecord[] {
  return [...subs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
