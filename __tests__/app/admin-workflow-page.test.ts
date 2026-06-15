/** @jest-environment node */
/**
 * /admin/workflow data loader — must load BOTH draft and published content so
 * the pre-publish pipeline columns aren't permanently empty (the original bug:
 * findAll defaulted to PUBLISHED-only).
 */

jest.mock('@/infrastructure/database/ContentRepository', () => {
  const findAll = jest.fn();
  return { ContentRepository: jest.fn(() => ({ findAll })), __findAll: findAll };
});

import { getAllContent } from '@/lib/workflow-content';
import { ContentStatus } from '@/types/content';

const repoMock = jest.requireMock('@/infrastructure/database/ContentRepository') as { __findAll: jest.Mock };
const findAll = repoMock.__findAll;

const entity = (o: Record<string, unknown>) => ({ toObject: () => o });

beforeEach(() => findAll.mockReset());

it('queries both DRAFT and PUBLISHED and merges + ISO-normalises the rows', async () => {
  findAll.mockImplementation(async ({ status }: { status: ContentStatus }) => ({
    items:
      status === ContentStatus.DRAFT
        ? [entity({ id: 'cnt_d', title: 'Draft Song', type: 'SONGS', status: 'DRAFT', workflowState: 'music_generated', updatedAt: new Date('2026-06-10T00:00:00Z') })]
        : [entity({ id: 'cnt_p', title: 'Live Song', type: 'SONGS', status: 'PUBLISHED' })],
    lastEvaluatedKey: undefined,
  }));

  const items = await getAllContent();

  const queriedStatuses = findAll.mock.calls.map((c) => c[0].status);
  expect(queriedStatuses).toContain(ContentStatus.DRAFT);
  expect(queriedStatuses).toContain(ContentStatus.PUBLISHED);

  expect(items.map((i) => i.id).sort()).toEqual(['cnt_d', 'cnt_p']);
  // the draft keeps its explicit workflowState and its Date is ISO-stringified
  const draft = items.find((i) => i.id === 'cnt_d')!;
  expect(draft.workflowState).toBe('music_generated');
  expect(draft.updatedAt).toBe('2026-06-10T00:00:00.000Z');
});

it('follows pagination within a status', async () => {
  let call = 0;
  findAll.mockImplementation(async ({ status }: { status: ContentStatus }) => {
    if (status === ContentStatus.DRAFT) {
      call++;
      return call === 1
        ? { items: [entity({ id: 'cnt_1', status: 'DRAFT' })], lastEvaluatedKey: { PK: 'x' } }
        : { items: [entity({ id: 'cnt_2', status: 'DRAFT' })], lastEvaluatedKey: undefined };
    }
    return { items: [], lastEvaluatedKey: undefined };
  });

  const items = await getAllContent();
  expect(items.map((i) => i.id).sort()).toEqual(['cnt_1', 'cnt_2']);
});

it('never throws — a repo failure yields an empty board', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  findAll.mockRejectedValue(new Error('DDB unavailable'));
  expect(await getAllContent()).toEqual([]);
});
