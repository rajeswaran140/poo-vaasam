/**
 * First-party analytics event store (DynamoDB), independent of GA4.
 *
 * Storage model — daily aggregate counters in the existing single table:
 *   PK = "EVENT"
 *   SK = "<YYYY-MM-DD>#<type>#<target>"
 *   count (atomic ADD), eventType, eventTarget, eventDate (denormalised)
 *
 * One item per (day, type, target) keeps writes contention-free (distinct SKs)
 * and lets the dashboard pull any date range with a single SK-BETWEEN query.
 * At this traffic a single "EVENT" partition is comfortably within limits; shard
 * to "EVENT#<month>" only if write volume ever demands it. See event-types.ts
 * for the type/target contract.
 */

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { sanitizeTarget, DERIVED_EVENT_TYPES, type StoreEventType } from '@/lib/event-types';

const PK = 'EVENT';

/** UTC day key, e.g. "2026-06-14". */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Record one occurrence of an event (atomic +1 on the day/type/target counter).
 * Accepts derived server-written types (share_song / inbound_song) as well as
 * the client-sendable ones — see lib/event-types.
 */
export async function recordEvent(type: StoreEventType, target?: string, date = todayUtc()): Promise<void> {
  const tgt = sanitizeTarget(target);
  await DynamoDBOperations.update({
    key: { PK, SK: `${date}#${type}#${tgt}` },
    updateExpression: 'SET #type = :type, #target = :target, #date = :date ADD #count :inc',
    expressionAttributeNames: {
      '#type': 'eventType',
      '#target': 'eventTarget',
      '#date': 'eventDate',
      '#count': 'count',
    },
    expressionAttributeValues: { ':type': type, ':target': tgt, ':date': date, ':inc': 1 },
  });
}

export interface EventRow {
  type: string;
  target: string;
  count: number;
  date: string;
}

export interface EventSummary {
  /**
   * Grand total of VISITOR ACTIONS in range. Server-derived types are excluded:
   * a share carrying a songId writes both `share` and `share_song` for the one
   * click, so counting both would inflate the headline — worst on shares, the
   * metric we actually steer by.
   */
  total: number;
  /** Per-type totals of client-sendable types only, descending. */
  totals: Array<{ type: string; count: number }>;
  /**
   * Per-type top targets, descending (capped at topN). Includes the derived
   * types — they're a genuine breakdown ("which song gets forwarded?"), just
   * not a separate action to be summed.
   */
  byType: Record<string, Array<{ target: string; count: number }>>;
}

const DERIVED = new Set<string>(DERIVED_EVENT_TYPES);

/**
 * Pure: roll up raw daily counter rows into totals + per-type top targets.
 * Separated from the DB read so it's unit-testable.
 */
export function summariseEvents(rows: EventRow[], topN = 8): EventSummary {
  const totalsMap = new Map<string, number>();
  const targetMaps = new Map<string, Map<string, number>>();
  let total = 0;

  for (const r of rows) {
    const c = Number(r.count) || 0;
    if (!r.type) continue;
    // Derived rows still feed byType (the per-song breakdown) but never the
    // action total — they are a second view of an action already counted.
    if (!DERIVED.has(r.type)) {
      total += c;
      totalsMap.set(r.type, (totalsMap.get(r.type) ?? 0) + c);
    }
    if (!targetMaps.has(r.type)) targetMaps.set(r.type, new Map());
    const tm = targetMaps.get(r.type)!;
    tm.set(r.target, (tm.get(r.target) ?? 0) + c);
  }

  const totals = [...totalsMap.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const byType: Record<string, Array<{ target: string; count: number }>> = {};
  for (const [type, tm] of targetMaps) {
    byType[type] = [...tm.entries()]
      .map(([target, count]) => ({ target, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);
  }

  return { total, totals, byType };
}

/** Read the last `days` of event counters from DynamoDB and summarise them. */
export async function fetchEventSummary(days = 28, topN = 8): Promise<EventSummary> {
  const to = todayUtc();
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

  const rows: EventRow[] = [];
  let cursor: Record<string, unknown> | undefined;
  // Cap pages defensively; one item per day/type/target keeps this tiny.
  for (let i = 0; i < 20; i++) {
    const res = await DynamoDBOperations.query({
      keyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
      expressionAttributeValues: { ':pk': PK, ':from': `${from}#`, ':to': `${to}#￿` },
      exclusiveStartKey: cursor as Record<string, unknown> | undefined,
    });
    for (const it of res.Items ?? []) {
      rows.push({
        type: String(it.eventType ?? ''),
        target: String(it.eventTarget ?? '-'),
        count: Number(it.count ?? 0),
        date: String(it.eventDate ?? ''),
      });
    }
    cursor = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (!cursor) break;
  }
  return summariseEvents(rows, topN);
}
