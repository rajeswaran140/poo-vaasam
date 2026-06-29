/** @jest-environment node */
/**
 * LyricDraftRepository — item-per-version single-table writes/reads.
 * DynamoDBOperations is mocked; we assert keys (PK/SK/GSI1) and assembly.
 */

import { LyricDraftRepository } from '@/infrastructure/database/LyricDraftRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: jest.fn(), get: jest.fn(), query: jest.fn(), delete: jest.fn() },
  handleDynamoDBError: jest.fn((e) => {
    throw e;
  }),
}));

const ops = DynamoDBOperations as unknown as {
  put: jest.Mock; get: jest.Mock; query: jest.Mock; delete: jest.Mock;
};

beforeEach(() => jest.clearAllMocks());

it('create() writes a metadata item + version 1 and returns the draft', async () => {
  ops.put.mockResolvedValue({});
  const draft = await new LyricDraftRepository().create({
    title: 'மண்வாசம்', lyrics: 'பல்லவி\nமண்ணின் வாசம்', focus: ['imagery'], critique: null,
  });

  expect(draft).toMatchObject({ title: 'மண்வாசம்', latestVersion: 1, status: 'draft' });
  expect(draft.versions).toHaveLength(1);
  expect(draft.id).toMatch(/^draft_/);

  const meta = ops.put.mock.calls[0][0];
  expect(meta.SK).toBe('METADATA');
  expect(meta.GSI1PK).toBe('LYRICDRAFT');
  expect(meta.GSI1SK).toBe(`${draft.updatedAt}#${draft.id}`);
  expect(meta.snippet).toBe('பல்லவி');

  const ver = ops.put.mock.calls[1][0];
  expect(ver.SK).toBe('VERSION#000001');
  expect(ver.lyrics).toContain('மண்ணின் வாசம்');
});

it('list() maps GSI1 rows newest-first (scanIndexForward:false)', async () => {
  ops.query.mockResolvedValue({
    Items: [
      { id: 'draft_b', title: 'B', status: 'draft', latestVersion: 2, snippet: 'b', updatedAt: '2026-06-29' },
      { id: 'draft_a', title: 'A', status: 'ready', latestVersion: 1, snippet: 'a', updatedAt: '2026-06-28' },
    ],
  });
  const out = await new LyricDraftRepository().list();
  expect(ops.query.mock.calls[0][0]).toMatchObject({ indexName: 'GSI1', scanIndexForward: false });
  expect(out.map((d) => d.id)).toEqual(['draft_b', 'draft_a']);
});

it('get() assembles metadata + versions in order, null when missing', async () => {
  ops.query.mockResolvedValueOnce({
    Items: [
      { SK: 'VERSION#000002', version: 2, lyrics: 'v2', focus: [], critique: null, createdAt: 'b' },
      { SK: 'METADATA', id: 'draft_x', title: 'X', status: 'draft', latestVersion: 2, createdAt: 'a', updatedAt: 'b' },
      { SK: 'VERSION#000001', version: 1, lyrics: 'v1', focus: [], critique: null, createdAt: 'a' },
    ],
  });
  const draft = await new LyricDraftRepository().get('draft_x');
  expect(draft!.versions.map((v) => v.version)).toEqual([1, 2]);

  ops.query.mockResolvedValueOnce({ Items: [] });
  expect(await new LyricDraftRepository().get('draft_gone')).toBeNull();
});

it('addVersion() increments to the next version and rewrites metadata', async () => {
  // get() reads the existing draft (1 version), then we put version 2 + new meta.
  ops.query.mockResolvedValueOnce({
    Items: [
      { SK: 'METADATA', id: 'draft_x', title: 'X', status: 'draft', latestVersion: 1, createdAt: 'a', updatedAt: 'a' },
      { SK: 'VERSION#000001', version: 1, lyrics: 'v1', focus: [], critique: null, createdAt: 'a' },
    ],
  });
  ops.put.mockResolvedValue({});
  const draft = await new LyricDraftRepository().addVersion('draft_x', { lyrics: 'v2 text', focus: [], critique: null });

  expect(draft.latestVersion).toBe(2);
  expect(draft.versions).toHaveLength(2);
  const ver = ops.put.mock.calls[0][0];
  expect(ver.SK).toBe('VERSION#000002');
  expect(ver.lyrics).toBe('v2 text');
});

it('delete() removes every item in the draft partition', async () => {
  ops.query.mockResolvedValueOnce({
    Items: [
      { PK: 'LYRICDRAFT#draft_x', SK: 'METADATA' },
      { PK: 'LYRICDRAFT#draft_x', SK: 'VERSION#000001' },
    ],
  });
  ops.delete.mockResolvedValue({});
  await new LyricDraftRepository().delete('draft_x');
  expect(ops.delete).toHaveBeenCalledTimes(2);
});
