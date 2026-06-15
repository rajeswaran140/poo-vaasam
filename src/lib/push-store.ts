/**
 * Web-push subscription store (DynamoDB, single table).
 *
 *   PK = "PUSHSUB"
 *   SK = sha256(endpoint)   — stable id so re-subscribing is idempotent
 *   endpoint, p256dh, auth, createdAt, ua
 *
 * The audience we OWN for new-song notifications, independent of any platform.
 * Pure validation is separated from the DB calls so it's unit-testable.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

const PK = 'PUSHSUB';

/** Browser PushSubscription shape we accept from the client. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().min(1).max(1000).refine((s) => /^https:\/\/.+/.test(s), 'endpoint must be an https URL'),
  keys: z.object({
    p256dh: z.string().min(1).max(300),
    auth: z.string().min(1).max(200),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export interface StoredPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Stable per-endpoint key so the same browser never double-subscribes. */
export function subscriptionId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

export async function savePushSubscription(sub: PushSubscriptionInput, ua?: string): Promise<void> {
  await DynamoDBOperations.put({
    PK,
    SK: subscriptionId(sub.endpoint),
    Type: 'PUSHSUB',
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    ua: ua?.slice(0, 200) ?? '',
    createdAt: new Date().toISOString(),
  });
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await DynamoDBOperations.delete({ PK, SK: subscriptionId(endpoint) });
}

/** All current subscriptions (paged). Shaped for the web-push library. */
export async function listPushSubscriptions(): Promise<StoredPushSubscription[]> {
  const out: StoredPushSubscription[] = [];
  let cursor: Record<string, unknown> | undefined;
  for (let i = 0; i < 50; i++) {
    const res = await DynamoDBOperations.query({
      keyConditionExpression: 'PK = :pk',
      expressionAttributeValues: { ':pk': PK },
      exclusiveStartKey: cursor as Record<string, unknown> | undefined,
    });
    for (const it of res.Items ?? []) {
      if (it.endpoint && it.p256dh && it.auth) {
        out.push({ endpoint: String(it.endpoint), keys: { p256dh: String(it.p256dh), auth: String(it.auth) } });
      }
    }
    cursor = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (!cursor) break;
  }
  return out;
}

export async function countPushSubscriptions(): Promise<number> {
  return (await listPushSubscriptions()).length;
}
