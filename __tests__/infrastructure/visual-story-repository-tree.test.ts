/** @jest-environment node */
/** Visual story repository — tree, ordering and draft apply. */

const mockQuery = jest.fn();
const mockPut = jest.fn(async (_i: any) => undefined);
const mockGet = jest.fn();
const mockUpdate = jest.fn(async (_p: any) => undefined);
const mockTransact = jest.fn(async (_i: any[]) => undefined);

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: (i: any) => mockPut(i),
    get: (k: any) => mockGet(k),
    query: (p: any) => mockQuery(p),
    update: (p: any) => mockUpdate(p),
    transactWrite: (i: any[]) => mockTransact(i),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import {
  VisualStoryRepository,
  DraftTooLargeError,
  vsPk,
  sceneSk,
  shotSk,
  candSk,
  charSk,
  draftSk,
} from '@/infrastructure/database/VisualStoryRepository';
import type { StoryboardDraft } from '@/types/visualStory';

const repo = new VisualStoryRepository();
const VS = 'vs_1730000000000_abcdef12';
const PK = vsPk(VS);

const meta = {
  PK, SK: 'METADATA', vsId: VS, masterJobId: 'm1', audioKey: 'a', contentId: null, title: 'Test song',
  status: 'DRAFT', aspectRatio: '16:9', providerId: 'grok', windowStartSec: 0, windowEndSec: 60,
  budgetUsdCap: 40, spentUsd: 0, reservedUsd: 0, committedUsd: 0, createdAt: 't', updatedAt: 't',
};
const shotItem = (s: number, h: number, durationSec: number, extra: any = {}) => ({
  PK, SK: shotSk(s, h), sceneOrder: s, shotOrder: h, mode: 'STILL', durationSec,
  visualPrompt: `p${s}${h}`, negativePrompt: '', charIds: [], selectedCandidateId: null, ...extra,
});
const sceneItem = (n: number) => ({ PK, SK: sceneSk(n), order: n, heading: `Scene ${n}`, summary: '' });
const candItem = (s: number, h: number, id: string) => ({
  PK, SK: candSk(s, h, id), candId: id, sceneOrder: s, shotOrder: h, jobId: 'j', providerId: 'grok',
  providerTaskId: '', s3Key: 'k', costUsd: 0.02, createdAt: 't',
});

const ops = (items: any[]) => ({
  puts: items.filter((i) => i.Put).map((i) => i.Put.Item),
  dels: items.filter((i) => i.Delete).map((i) => i.Delete.Key),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReset();
  mockGet.mockReset();
});

describe('loadTree', () => {
  it('returns null when the story does not exist', async () => {
    mockQuery.mockResolvedValue({ Items: [] });
    expect(await repo.loadTree(VS)).toBeNull();
  });

  it('splits by prefix and derives cumulative startSec across scenes', async () => {
    mockQuery.mockResolvedValue({
      Items: [
        candItem(1, 1, 'cd_1'),
        { PK, SK: charSk('ch_1'), charId: 'ch_1', name: 'A', description: '', refImageKeys: [], createdAt: 't' },
        { PK, SK: draftSk('dr_1'), draftId: 'dr_1', lyricsHash: 'h', model: 'm', inputTokens: 1, outputTokens: 2, costUsd: 0.1, characters: [], scenes: [], createdAt: 't' },
        meta,
        sceneItem(1),
        sceneItem(2),
        shotItem(1, 1, 5),
        shotItem(1, 2, 8),
        shotItem(2, 1, 2),
      ],
    });
    const tree = await repo.loadTree(VS);
    expect(tree!.story.vsId).toBe(VS);
    expect(tree!.scenes.map((s) => s.order)).toEqual([1, 2]);
    expect(tree!.shots.map((s) => s.startSec)).toEqual([0, 5, 13]);
    expect(tree!.characters).toHaveLength(1);
    expect(tree!.candidates).toHaveLength(1);
    expect(tree!.drafts).toHaveLength(1);
    expect((tree!.shots[0] as any).PK).toBeUndefined();
  });

  it('orders shots even when the query returns them unsorted, and follows pagination', async () => {
    mockQuery
      .mockResolvedValueOnce({ Items: [meta, shotItem(2, 1, 2), shotItem(1, 2, 8)], LastEvaluatedKey: { PK, SK: 'x' } })
      .mockResolvedValueOnce({ Items: [shotItem(1, 1, 5)] });
    const tree = await repo.loadTree(VS);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(tree!.shots.map((s) => [s.sceneOrder, s.shotOrder, s.startSec])).toEqual([
      [1, 1, 0], [1, 2, 5], [2, 1, 13],
    ]);
  });
});

describe('simple writes', () => {
  it('putScene / putShot / putCharacter / putCandidate use the key builders and drop startSec', async () => {
    await repo.putScene(VS, { order: 2, heading: 'H', summary: 'S' });
    await repo.putShot(VS, { ...(shotItem(2, 3, 4) as any), startSec: 99 });
    await repo.putCharacter(VS, { charId: 'ch_1', name: 'A', description: 'd', refImageKeys: [], createdAt: 't' });
    await repo.putCandidate(VS, candItem(1, 2, 'cd_9') as any);
    const puts = mockPut.mock.calls.map((c) => c[0]);
    expect(puts.map((p) => p.SK)).toEqual([sceneSk(2), shotSk(2, 3), charSk('ch_1'), candSk(1, 2, 'cd_9')]);
    expect(puts.every((p) => p.PK === PK)).toBe(true);
    expect(puts[1].startSec).toBeUndefined();
  });

  it('addCharacterRef appends to refImageKeys on an existing character only', async () => {
    await repo.addCharacterRef(VS, 'ch_1', 'audio/mastering/visual-story/x/refs/a.png');
    const p = mockUpdate.mock.calls[0][0];
    expect(p.key).toEqual({ PK, SK: charSk('ch_1') });
    expect(p.updateExpression).toContain('list_append');
    expect(p.conditionExpression).toBe('attribute_exists(PK)');
  });

  it('selectCandidate sets selectedCandidateId on the shot', async () => {
    mockGet.mockResolvedValue(candItem(1, 2, 'cd_9'));
    await repo.selectCandidate(VS, 1, 2, 'cd_9');
    const p = mockUpdate.mock.calls[0][0];
    expect(p.key).toEqual({ PK, SK: shotSk(1, 2) });
    expect(Object.values(p.expressionAttributeValues)).toContain('cd_9');
    expect(p.conditionExpression).toBe('attribute_exists(PK)');
  });

  it('selectCandidate refuses a candidate that is not on that shot', async () => {
    mockGet.mockResolvedValue(undefined);
    await expect(repo.selectCandidate(VS, 1, 2, 'cd_x')).rejects.toThrow(/candidate/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('putDraft / getDraft round-trip through the draft key', async () => {
    const d: StoryboardDraft = {
      draftId: 'dr_1', lyricsHash: 'h', model: 'm', inputTokens: 1, outputTokens: 2, costUsd: 0.1,
      characters: [], scenes: [], createdAt: 't',
    };
    await repo.putDraft(VS, d);
    expect(mockPut.mock.calls[0][0]).toMatchObject({ PK, SK: draftSk('dr_1'), draftId: 'dr_1' });
    mockGet.mockResolvedValue({ PK, SK: draftSk('dr_1'), ...d });
    const got = await repo.getDraft(VS, 'dr_1');
    expect(got).toEqual(d);
    mockGet.mockResolvedValue(undefined);
    expect(await repo.getDraft(VS, 'dr_2')).toBeNull();
  });
});

describe('deleteShot', () => {
  it('deletes the shot and its candidates in one transaction', async () => {
    mockQuery.mockResolvedValue({ Items: [shotItem(1, 2, 5), candItem(1, 2, 'cd_1'), candItem(1, 3, 'cd_2')] });
    await repo.deleteShot(VS, 1, 2);
    const { dels, puts } = ops(mockTransact.mock.calls[0][0]);
    expect(puts).toHaveLength(0);
    expect(dels.map((k: any) => k.SK).sort()).toEqual([shotSk(1, 2), candSk(1, 2, 'cd_1')].sort());
  });
});

describe('reorderShots', () => {
  it('rewrites shots and their candidates under the new positions in one transaction', async () => {
    mockQuery.mockResolvedValue({
      Items: [shotItem(1, 1, 5), shotItem(1, 2, 8), shotItem(1, 3, 2), candItem(1, 3, 'cd_1')],
    });
    await repo.reorderShots(VS, 1, [3, 1, 2]);
    expect(mockTransact).toHaveBeenCalledTimes(1);
    const { puts, dels } = ops(mockTransact.mock.calls[0][0]);
    const byOrder = Object.fromEntries(puts.filter((p: any) => p.SK.startsWith('SHOT#')).map((p: any) => [p.shotOrder, p.visualPrompt]));
    expect(byOrder).toEqual({ 1: 'p13', 2: 'p11', 3: 'p12' });
    const cand = puts.find((p: any) => p.SK.startsWith('CAND#'));
    expect(cand.SK).toBe(candSk(1, 1, 'cd_1'));
    expect(cand.shotOrder).toBe(1);
    // old candidate key is gone; no key is both put and deleted (DynamoDB forbids it)
    expect(dels.map((k: any) => k.SK)).toEqual([candSk(1, 3, 'cd_1')]);
    const putKeys = new Set(puts.map((p: any) => p.SK));
    expect(dels.some((k: any) => putKeys.has(k.SK))).toBe(false);
  });

  it('closes gaps: deletes old keys that are not reused', async () => {
    mockQuery.mockResolvedValue({ Items: [shotItem(1, 2, 5), shotItem(1, 5, 8)] });
    await repo.reorderShots(VS, 1, [5, 2]);
    const { puts, dels } = ops(mockTransact.mock.calls[0][0]);
    expect(puts.map((p: any) => p.SK).sort()).toEqual([shotSk(1, 1)]); // shot 2 keeps its slot, untouched
    expect(dels.map((k: any) => k.SK)).toEqual([shotSk(1, 5)]);
  });

  it('rejects an order that is not a permutation of the scene\'s shots', async () => {
    mockQuery.mockResolvedValue({ Items: [shotItem(1, 1, 5), shotItem(1, 2, 8)] });
    await expect(repo.reorderShots(VS, 1, [1, 1])).rejects.toThrow(/permutation|order/i);
    await expect(repo.reorderShots(VS, 1, [1])).rejects.toThrow(/permutation|order/i);
    expect(mockTransact).not.toHaveBeenCalled();
  });
});

describe('applyDraft', () => {
  const draft = (scenes: number, shotsPerScene: number[], characters: any[] = []): StoryboardDraft => ({
    draftId: 'dr_1', lyricsHash: 'h', model: 'm', inputTokens: 1, outputTokens: 2, costUsd: 0.1,
    characters,
    scenes: Array.from({ length: scenes }, (_, i) => ({
      heading: `Scene ${i + 1}`, summary: 's',
      shots: Array.from({ length: shotsPerScene[i] }, (_, j) => ({
        durationSec: 5, mode: 'STILL' as const, visualPrompt: `v${i}${j}`, characterNames: ['Asha', 'Ghost'],
      })),
    })),
    createdAt: 't',
  });

  it('writes 3 scenes + 8 shots + new characters and deletes prior scenes/shots', async () => {
    mockGet.mockResolvedValue({ PK, SK: draftSk('dr_1'), ...draft(3, [3, 3, 2], [
      { name: 'Asha', description: 'new' }, { name: 'Ravi', description: 'new2' },
    ]) });
    mockQuery.mockResolvedValue({
      Items: [
        meta, sceneItem(1), sceneItem(2), sceneItem(3), sceneItem(4), shotItem(1, 1, 5), shotItem(4, 1, 5),
        candItem(1, 1, 'cd_1'),
        { PK, SK: charSk('ch_old'), charId: 'ch_old', name: ' asha ', description: 'keep', refImageKeys: [], createdAt: 't' },
      ],
    });
    await repo.applyDraft(VS, 'dr_1');
    expect(mockTransact).toHaveBeenCalledTimes(1);
    const { puts, dels } = ops(mockTransact.mock.calls[0][0]);
    expect(puts.filter((p: any) => p.SK.startsWith('SCENE#'))).toHaveLength(3);
    expect(puts.filter((p: any) => p.SK.startsWith('SHOT#'))).toHaveLength(8);
    const chars = puts.filter((p: any) => p.SK.startsWith('CHAR#'));
    expect(chars.map((c: any) => c.name)).toEqual(['Ravi']); // Asha exists (case/space-insensitive)
    // prior scene 4 and shot 4#1 deleted; reused keys are overwritten, not deleted
    // (and the candidate of a replaced shot, so nothing is orphaned)
    expect(dels.map((k: any) => k.SK).sort()).toEqual([sceneSk(4), shotSk(4, 1), candSk(1, 1, 'cd_1')].sort());
    // shots reference the existing character id; unknown names are dropped
    const firstShot = puts.find((p: any) => p.SK === shotSk(1, 1));
    expect(firstShot.charIds).toEqual(['ch_old']);
    expect(firstShot.negativePrompt).toBe('');
    expect(firstShot.selectedCandidateId).toBeNull();
  });

  it('deletes candidates that belonged to replaced shots', async () => {
    mockGet.mockResolvedValue({ PK, SK: draftSk('dr_1'), ...draft(1, [1]) });
    mockQuery.mockResolvedValue({ Items: [meta, shotItem(1, 1, 5), candItem(1, 1, 'cd_1')] });
    await repo.applyDraft(VS, 'dr_1');
    const { dels } = ops(mockTransact.mock.calls[0][0]);
    expect(dels.map((k: any) => k.SK)).toEqual([candSk(1, 1, 'cd_1')]);
  });

  it('throws DraftTooLargeError when deletes + puts exceed 100', async () => {
    mockGet.mockResolvedValue({ PK, SK: draftSk('dr_1'), ...draft(10, Array(10).fill(9)) }); // 10 + 90 = 100
    mockQuery.mockResolvedValue({ Items: [meta, shotItem(11, 1, 5)] }); // +1 delete = 101
    await expect(repo.applyDraft(VS, 'dr_1')).rejects.toBeInstanceOf(DraftTooLargeError);
    expect(mockTransact).not.toHaveBeenCalled();
  });

  it('allows exactly 100', async () => {
    mockGet.mockResolvedValue({ PK, SK: draftSk('dr_1'), ...draft(10, Array(10).fill(9)) });
    mockQuery.mockResolvedValue({ Items: [meta] });
    await repo.applyDraft(VS, 'dr_1');
    expect(mockTransact.mock.calls[0][0]).toHaveLength(100);
  });

  it('throws when the draft is missing', async () => {
    mockGet.mockResolvedValue(undefined);
    await expect(repo.applyDraft(VS, 'dr_x')).rejects.toThrow(/draft/i);
  });
});
