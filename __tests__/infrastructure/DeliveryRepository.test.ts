/** @jest-environment node */
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: jest.fn(async () => ({})),
    get: jest.fn(async () => ({ Item: undefined })),
    query: jest.fn(async () => ({ Items: [] })),
    update: jest.fn(async () => ({})),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { DeliveryRepository, DELIVERY_INDEX_PK } from '@/infrastructure/database/DeliveryRepository';

const put = DynamoDBOperations.put as jest.Mock;
const get = DynamoDBOperations.get as jest.Mock;
const update = DynamoDBOperations.update as jest.Mock;
const query = DynamoDBOperations.query as jest.Mock;
beforeEach(() => jest.clearAllMocks());

describe('create', () => {
  it('writes a keyed item with the sparse index and a 7-day expiry', async () => {
    const d = await new DeliveryRepository().create({
      s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'Buyer',
    });
    const item = put.mock.calls[0][0];
    expect(item.PK).toBe(`DELIVERY#${d.token}`);
    expect(item.SK).toBe('METADATA');
    expect(item.entityType).toBe('DELIVERY');
    expect(item.GSI1PK).toBe(DELIVERY_INDEX_PK);
    expect(item.maxDownloads).toBe(5);
    expect(item.downloadCount).toBe(0);
    const days = (Date.parse(item.expiresAt) - Date.parse(item.createdAt)) / 86_400_000;
    expect(Math.round(days)).toBe(7);
  });

  it('sets a ttl well after expiry, so cleanup never races enforcement', async () => {
    await new DeliveryRepository().create({ s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'B' });
    const item = put.mock.calls[0][0];
    expect(item.ttl * 1000).toBeGreaterThan(Date.parse(item.expiresAt));
  });

  it('does not write revokedAt, so the ConditionExpression works on first claim', async () => {
    await new DeliveryRepository().create({ s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'B' });
    const item = put.mock.calls[0][0];
    expect('revokedAt' in item).toBe(false);
  });
});

describe('consume', () => {
  it('increments under a condition so two clicks cannot both pass the cap', async () => {
    update.mockResolvedValueOnce({ token: 't', downloadCount: 1, downloads: [] });
    await new DeliveryRepository().consume('t'.repeat(43), '1.2.3.4', 3);
    const p = update.mock.calls[0][0];
    expect(p.conditionExpression).toContain('downloadCount < :max');
    expect(p.conditionExpression).toContain('attribute_not_exists(revokedAt)');
    expect(p.updateExpression).toContain('ADD');
  });

  it('binds the passed maxDownloads to the condition, so per-link caps are enforced', async () => {
    update.mockResolvedValueOnce({ token: 't', downloadCount: 1, downloads: [] });
    await new DeliveryRepository().consume('t'.repeat(43), '1.2.3.4', 5);
    const p = update.mock.calls[0][0];
    expect(p.expressionAttributeValues[':max']).toBe(5);
  });

  it('reports exhausted rather than throwing when the condition fails', async () => {
    const err = Object.assign(new Error('conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    });
    update.mockRejectedValueOnce(err);
    const r = await new DeliveryRepository().consume('t'.repeat(43), '1.2.3.4', 3);
    expect(r).toEqual({ ok: false, reason: 'exhausted' });
  });

  it('records the hit with an ip, so a disputed delivery has evidence', async () => {
    update.mockResolvedValueOnce({ token: 't', downloadCount: 1, downloads: [] });
    await new DeliveryRepository().consume('t'.repeat(43), '9.9.9.9', 3);
    const p = update.mock.calls[0][0];
    expect(JSON.stringify(p.expressionAttributeValues)).toContain('9.9.9.9');
  });
});

describe('findByToken', () => {
  it('returns a fully-mapped Delivery when the row exists', async () => {
    const token = 't'.repeat(43);
    get.mockResolvedValueOnce({
      token,
      s3Key: 'deliveries/test.mp3',
      filename: 'test.mp3',
      label: 'Test Label',
      contentLength: 1024,
      createdAt: '2026-09-14T12:00:00Z',
      expiresAt: '2026-09-21T12:00:00Z',
      maxDownloads: 5,
      downloadCount: 2,
      downloads: [],
      revokedAt: null,
    });
    const d = await new DeliveryRepository().findByToken(token);
    expect(d).not.toBeNull();
    expect(d?.s3Key).toBe('deliveries/test.mp3');
    expect(d?.maxDownloads).toBe(5);
  });

  it('returns null when the row does not exist', async () => {
    get.mockResolvedValueOnce(undefined);
    const d = await new DeliveryRepository().findByToken('t'.repeat(43));
    expect(d).toBeNull();
  });
});

describe('list', () => {
  it('queries the sparse index, never a scan', async () => {
    await new DeliveryRepository().list();
    expect(query.mock.calls[0][0].indexName).toBe('GSI1');
    expect(query.mock.calls[0][0].expressionAttributeValues[':pk']).toBe(DELIVERY_INDEX_PK);
  });
});

/**
 * The guards that must live in the DATABASE, not in the caller's read above it.
 * The module's own comment says "the database is what actually decides" — these
 * are what make that true rather than two-thirds true.
 */
describe('what the condition actually enforces', () => {
  const claim = async () => {
    update.mockClear();
    update.mockResolvedValueOnce({});
    await new DeliveryRepository().consume('a'.repeat(43), '1.2.3.4', 5);
    return update.mock.calls[0][0];
  };

  it('refuses an EXPIRED link at the database, not only at the read', async () => {
    // Expiry used to be checked solely by the caller. Any future caller that
    // skipped that read would have served an expired link.
    expect((await claim()).conditionExpression).toContain('expiresAt >');
  });

  it('still refuses a revoked link and an exhausted one', async () => {
    const c = (await claim()).conditionExpression;
    expect(c).toContain('attribute_not_exists(revokedAt)');
    expect(c).toContain('downloadCount <');
  });

  it('compares dates as ISO strings, which is a date compare', async () => {
    expect(String((await claim()).expressionAttributeValues[':now'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

/**
 * A refusal has to say WHICH guard refused. Telling a buyer "already used" when
 * the link was revoked — or had expired — is a wrong answer to a question they
 * will ask about.
 */
describe('why a claim was refused', () => {
  const refuse = async (row: Record<string, unknown> | null) => {
    update.mockClear();
    update.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'ConditionalCheckFailedException' }));
    (DynamoDBOperations.get as jest.Mock).mockResolvedValueOnce(row);
    return new DeliveryRepository().consume('a'.repeat(43), '1.2.3.4', 5);
  };
  const base = {
    token: 'a'.repeat(43), s3Key: 'deliveries/x.mp3', filename: 'x.mp3', label: 'l',
    contentLength: 1, createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z', maxDownloads: 5, downloadCount: 0, downloads: [],
  };

  it('says revoked when the link was revoked', async () => {
    expect(await refuse({ ...base, revokedAt: '2026-09-18T00:00:00.000Z' }))
      .toEqual({ ok: false, reason: 'revoked' });
  });

  it('says expired when the link had expired', async () => {
    expect(await refuse({ ...base, expiresAt: '2020-01-01T00:00:00.000Z' }))
      .toEqual({ ok: false, reason: 'expired' });
  });

  it('says exhausted when the cap was reached', async () => {
    expect(await refuse({ ...base, downloadCount: 5 }))
      .toEqual({ ok: false, reason: 'exhausted' });
  });

  it('falls back to exhausted when the row has gone', async () => {
    expect(await refuse(null)).toEqual({ ok: false, reason: 'exhausted' });
  });
});

/**
 * ⚠️ DynamoDB's UpdateItem UPSERTS. Revoking a mistyped token used to CREATE a
 * row — revokedAt set, no GSI1PK so it never appeared in the list, no ttl so it
 * never expired. Permanent invisible junk from a typo.
 */
describe('revoke', () => {
  it('is conditional on the row existing', async () => {
    update.mockClear();
    update.mockResolvedValueOnce({});
    await new DeliveryRepository().revoke('a'.repeat(43));
    expect(update.mock.calls[0][0].conditionExpression).toBe('attribute_exists(PK)');
  });

  it('reports false rather than throwing when there was nothing to revoke', async () => {
    update.mockClear();
    update.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'ConditionalCheckFailedException' }));
    await expect(new DeliveryRepository().revoke('b'.repeat(43))).resolves.toBe(false);
  });

  it('reports true when it revoked something', async () => {
    update.mockClear();
    update.mockResolvedValueOnce({});
    await expect(new DeliveryRepository().revoke('c'.repeat(43))).resolves.toBe(true);
  });
});
