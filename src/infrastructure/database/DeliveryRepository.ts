/**
 * Persistence for expiring delivery links.
 *
 * The interesting part is `consume`: the cap is enforced by a DynamoDB
 * ConditionExpression, not by a read-then-write. Two clicks arriving together
 * would both pass a `downloadCount < max` check made in application code.
 */
import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import {
  newDeliveryToken, DEFAULT_MAX_DOWNLOADS, DEFAULT_TTL_DAYS,
  type Delivery, type CreateDeliveryInput,
} from '@/types/delivery';

/** Sparse GSI1 partition holding every delivery. Namespaced; cannot collide. */
export const DELIVERY_INDEX_PK = 'DELIVERY';

/** Rows survive 30 days past expiry — TTL is cleanup, never the control. */
const TTL_GRACE_DAYS = 30;

const pk = (token: string) => `DELIVERY#${token}`;

function toDelivery(i: Record<string, unknown>): Delivery {
  return {
    token: String(i.token),
    s3Key: String(i.s3Key),
    filename: String(i.filename),
    label: String(i.label ?? ''),
    contentLength: Number(i.contentLength ?? 0),
    createdAt: String(i.createdAt),
    expiresAt: String(i.expiresAt),
    maxDownloads: Number(i.maxDownloads ?? DEFAULT_MAX_DOWNLOADS),
    downloadCount: Number(i.downloadCount ?? 0),
    downloads: Array.isArray(i.downloads) ? (i.downloads as Delivery['downloads']) : [],
    revokedAt: (i.revokedAt as string | null) ?? null,
  };
}

export class DeliveryRepository {
  async create(input: CreateDeliveryInput & { contentLength?: number }): Promise<Delivery> {
    try {
      const token = newDeliveryToken();
      const now = new Date();
      const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
      const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000).toISOString();
      const delivery: Delivery = {
        token,
        s3Key: input.s3Key,
        filename: input.filename,
        label: input.label,
        contentLength: input.contentLength ?? 0,
        createdAt: now.toISOString(),
        expiresAt,
        maxDownloads: input.maxDownloads ?? DEFAULT_MAX_DOWNLOADS,
        downloadCount: 0,
        downloads: [],
        revokedAt: null,
      };
      const { revokedAt, ...deliveryWithoutRevoked } = delivery;
      await DynamoDBOperations.put({
        PK: pk(token), SK: 'METADATA', entityType: 'DELIVERY', ...deliveryWithoutRevoked,
        GSI1PK: DELIVERY_INDEX_PK,
        GSI1SK: `${delivery.createdAt}#${token}`,
        ttl: Math.floor((Date.parse(expiresAt) + TTL_GRACE_DAYS * 86_400_000) / 1000),
      });
      return delivery;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async findByToken(token: string): Promise<Delivery | null> {
    try {
      const r = await DynamoDBOperations.get({ PK: pk(token), SK: 'METADATA' });
      return r ? toDelivery(r as Record<string, unknown>) : null;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async list(): Promise<Delivery[]> {
    try {
      const r = await DynamoDBOperations.query({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': DELIVERY_INDEX_PK },
        scanIndexForward: false,
      });
      return (r.Items ?? []).map((i) => toDelivery(i as Record<string, unknown>));
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  /**
   * Claim one download. The condition is the cap: a failure means the link is
   * used up or revoked, which is an answer, not an error.
   *
   * The cap comes from the row, passed in by the caller that already read it.
   * A ConditionExpression cannot compare a value against another attribute of the same item,
   * which is why it arrives as an argument rather than being read here.
   */
  async consume(
    token: string,
    ip: string,
    maxDownloads: number
  ): Promise<{ ok: true; delivery: Delivery } | { ok: false; reason: 'exhausted' }> {
    const hit = { at: new Date().toISOString(), ip };
    try {
      const updated = await DynamoDBOperations.update({
        key: { PK: pk(token), SK: 'METADATA' },
        updateExpression:
          'ADD downloadCount :one SET downloads = list_append(if_not_exists(downloads, :empty), :hit)',
        conditionExpression: 'downloadCount < :max AND attribute_not_exists(revokedAt)',
        expressionAttributeValues: {
          ':one': 1, ':hit': [hit], ':empty': [], ':max': maxDownloads,
        },
      });
      return { ok: true, delivery: toDelivery((updated ?? {}) as Record<string, unknown>) };
    } catch (error) {
      if ((error as { name?: string })?.name === 'ConditionalCheckFailedException') {
        return { ok: false, reason: 'exhausted' };
      }
      handleDynamoDBError(error);
    }
  }

  async revoke(token: string): Promise<void> {
    try {
      await DynamoDBOperations.update({
        key: { PK: pk(token), SK: 'METADATA' },
        updateExpression: 'SET revokedAt = :at',
        expressionAttributeValues: { ':at': new Date().toISOString() },
      });
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
}
