/**
 * Impressions log — DynamoDB persistence.
 *
 * Human-entered Studio readings (see impressions-log.ts for why they cannot
 * come from an API). Mirrors the search-observation store's shape so the two
 * manual layers behave the same way.
 *
 * Storage model (existing single table):
 *   PK = "IMPRESSIONLOG#<scope>"   scope = 11-char videoId, or "CHANNEL"
 *   SK = "<observedAt ISO>"        newest-first when queried descending
 */

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import type { ImpressionEntry } from '@/lib/impressions-log';

const pkFor = (scope: string) => `IMPRESSIONLOG#${scope}`;

/** Max readings pulled for one scope. A weekly cadence makes this ~4 years. */
const READ_LIMIT = 200;

export async function logImpressions(e: ImpressionEntry): Promise<void> {
  await DynamoDBOperations.put({ PK: pkFor(e.scope), SK: e.observedAt, ...e });
}

/** All readings for one scope, newest first. */
export async function readImpressions(scope: string, limit = READ_LIMIT): Promise<ImpressionEntry[]> {
  const res = await DynamoDBOperations.query({
    keyConditionExpression: 'PK = :pk',
    expressionAttributeValues: { ':pk': pkFor(scope) },
    scanIndexForward: false, // SK is the ISO timestamp → descending = newest first
    limit,
  });
  return ((res.Items ?? []) as ImpressionEntry[]).filter((e) => typeof e.impressions === 'number');
}

/**
 * Delete one reading by its exact timestamp.
 *
 * Present because these are hand-typed: a transposed digit stored as fact is
 * worse than a missing week, and there is no other way to take it back.
 */
export async function deleteImpressions(scope: string, observedAt: string): Promise<void> {
  await DynamoDBOperations.delete({ PK: pkFor(scope), SK: observedAt });
}
