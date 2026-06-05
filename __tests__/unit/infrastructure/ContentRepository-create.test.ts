/**
 * ContentRepository.create — the atomic create path (audit M1/M3/M4).
 *
 * Verifies the single transaction writes the content item, the slug-uniqueness
 * guard, and the category/tag relationship rows; that a cancelled transaction
 * surfaces as SlugConflictError; and that delete releases the slug guard.
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { Content } from '@/domain/entities/Content';
import { ContentType, ContentStatus } from '@/types/content';
import { SlugConflictError } from '@/application/errors';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: jest.fn(),
    get: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
    transactWrite: jest.fn().mockResolvedValue(undefined),
  },
  handleDynamoDBError: jest.fn((error) => {
    throw error;
  }),
}));

const ops = DynamoDBOperations as unknown as {
  get: jest.Mock;
  delete: jest.Mock;
  transactWrite: jest.Mock;
};

function makeContent(extra: Partial<Parameters<typeof Content.create>[0]> = {}) {
  return Content.create({
    type: ContentType.SONGS,
    title: 'Hello World',
    body: 'Body',
    description: '',
    author: 'A',
    slug: 'hello-world',
    categoryIds: ['cat_1'],
    tagIds: ['tag_1', 'tag_2'],
    ...extra,
  });
}

describe('ContentRepository.create', () => {
  let repo: ContentRepository;
  beforeEach(() => {
    repo = new ContentRepository();
    jest.clearAllMocks();
    ops.transactWrite.mockResolvedValue(undefined);
    ops.delete.mockResolvedValue(undefined);
  });

  it('writes content + slug guard + relationship rows in ONE transaction', async () => {
    const content = makeContent();
    await repo.create(content);

    expect(ops.transactWrite).toHaveBeenCalledTimes(1);
    const items = ops.transactWrite.mock.calls[0][0] as Array<Record<string, any>>;

    // 1 content + 1 slug guard + 1 category + 2 tags = 5
    expect(items).toHaveLength(5);

    const contentPut = items.find((i) => i.Put?.Item?.SK === 'METADATA')!;
    expect(contentPut.Put.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(contentPut.Put.Item.PK).toBe(`CONTENT#${content.id}`);

    const slugPut = items.find((i) => i.Put?.Item?.PK?.startsWith('SLUG#'))!;
    expect(slugPut.Put.Item.PK).toBe('SLUG#hello-world');
    expect(slugPut.Put.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(slugPut.Put.Item.contentId).toBe(content.id);

    const catRow = items.find((i) => i.Put?.Item?.SK === 'CATEGORY#cat_1')!;
    expect(catRow.Put.Item.GSI2PK).toBe('CATEGORY#cat_1');
    expect(catRow.Put.Item.GSI2SK).toContain(content.id);

    const tagRows = items.filter((i) => String(i.Put?.Item?.SK).startsWith('TAG#'));
    expect(tagRows).toHaveLength(2);
    expect(tagRows.map((r) => r.Put.Item.GSI3PK).sort()).toEqual(['TAG#tag_1', 'TAG#tag_2']);
  });

  it('writes only content + slug guard when there are no categories/tags', async () => {
    await repo.create(makeContent({ categoryIds: [], tagIds: [] }));
    const items = ops.transactWrite.mock.calls[0][0] as unknown[];
    expect(items).toHaveLength(2);
  });

  it('maps a cancelled transaction (duplicate slug) to SlugConflictError', async () => {
    ops.transactWrite.mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' })
    );
    await expect(repo.create(makeContent())).rejects.toBeInstanceOf(SlugConflictError);
  });

  it('release the slug guard on delete', async () => {
    ops.get.mockResolvedValueOnce({
      id: 'cnt_1', type: ContentType.SONGS, title: 'Hello World', titleSlug: 'hello-world',
      body: 'b', description: '', author: 'A', status: ContentStatus.DRAFT,
      categoryIds: [], tagIds: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    await repo.delete('cnt_1');

    const deletedKeys = ops.delete.mock.calls.map((c) => c[0]);
    expect(deletedKeys).toContainEqual({ PK: 'SLUG#hello-world', SK: 'SLUG' });
    expect(deletedKeys).toContainEqual({ PK: 'CONTENT#cnt_1', SK: 'METADATA' });
  });
});
