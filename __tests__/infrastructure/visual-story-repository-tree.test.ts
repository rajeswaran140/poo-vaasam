/** @jest-environment node */
/** Visual story repository — tree, ordering and draft apply. */

const mockQuery = jest.fn();
const mockPut = jest.fn(async (_i: any) => undefined);
const mockGet = jest.fn();
const mockUpdate = jest.fn(async (_p: any) => undefined);
const mockTransact = jest.fn(async (_i: any[]) => undefined);
const mockDelete = jest.fn(async (_k: any) => undefined);

jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: (i: any) => mockPut(i),
    get: (k: any) => mockGet(k),
    query: (p: any) => mockQuery(p),
    update: (p: any) => mockUpdate(p),
    transactWrite: (i: any[]) => mockTransact(i),
    delete: (k: any) => mockDelete(k),
  },
  // Mirrors the real function: it NEVER rethrows the original, it wraps into a 500.
  handleDynamoDBError: (e: any) => {
    const w: any = new Error(e?.message || 'Unknown DynamoDB error');
    w.name = 'DynamoDBError';
    w.statusCode = 500;
    throw w;
  },
}));

import {
  VisualStoryRepository,
  DraftTooLargeError,
  InvalidReorderError,
  NotFoundError,
  vsPk,
  sceneSk,
  shotSk,
  candSk,
  charSk,
  draftSk,
  draftJobSk,
  genJobSk,
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

/** A GENJOB# row; settled terminal by default (the only kind a shot edit may drop). */
const jobItem = (s: number, h: number, id: string, extra: any = {}) => ({
  PK, SK: genJobSk(id), jobId: id, sceneOrder: s, shotOrder: h, status: 'failed', code: 'upstream',
  error: 'x', reservedUsd: 0.4, settledAt: 't', billedUsd: 0, createdAt: 't', updatedAt: 't', ...extra,
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

  describe('removeCharacterRef', () => {
    const K = 'audio/mastering/visual-story/x/refs/b.png';
    const char = (keys: string[]) => ({ PK, SK: charSk('ch_1'), charId: 'ch_1', refImageKeys: keys });

    it('removes by index, conditional on that slot still holding the key', async () => {
      mockGet.mockResolvedValue(char(['a', K, 'c']));
      await repo.removeCharacterRef(VS, 'ch_1', K);
      const p = mockUpdate.mock.calls[0][0];
      expect(p.key).toEqual({ PK, SK: charSk('ch_1') });
      expect(p.updateExpression).toBe('REMOVE refImageKeys[1]');
      expect(p.conditionExpression).toBe('refImageKeys[1] = :k');
      expect(p.expressionAttributeValues).toEqual({ ':k': K });
    });
    it('throws NotFoundError when the key (or character) is absent, without writing', async () => {
      mockGet.mockResolvedValue(char(['a']));
      await expect(repo.removeCharacterRef(VS, 'ch_1', K)).rejects.toBeInstanceOf(NotFoundError);
      mockGet.mockResolvedValue(undefined);
      await expect(repo.removeCharacterRef(VS, 'ch_1', K)).rejects.toBeInstanceOf(NotFoundError);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
    it('re-reads and retries when the list shifted under it', async () => {
      mockGet.mockResolvedValueOnce(char(['a', K])).mockResolvedValueOnce(char([K]));
      mockUpdate.mockRejectedValueOnce(Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' }));
      await repo.removeCharacterRef(VS, 'ch_1', K);
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockUpdate.mock.calls[1][0].updateExpression).toBe('REMOVE refImageKeys[0]');
    });
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
    await expect(repo.selectCandidate(VS, 1, 2, 'cd_x')).rejects.toBeInstanceOf(NotFoundError);
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
  it('deletes the shot and its candidates item by item (no 100-item transaction limit)', async () => {
    mockQuery.mockResolvedValue({ Items: [shotItem(1, 2, 5), candItem(1, 2, 'cd_1'), candItem(1, 3, 'cd_2')] });
    await repo.deleteShot(VS, 1, 2);
    expect(mockTransact).not.toHaveBeenCalled();
    expect(mockDelete.mock.calls.map((c) => c[0].SK).sort()).toEqual([shotSk(1, 2), candSk(1, 2, 'cd_1')].sort());
  });
});

describe('old video jobs never attach to another shot', () => {
  const delSks = () => mockDelete.mock.calls.map((c) => c[0].SK).sort();

  it('deleteShot also deletes that shot\'s settled terminal GENJOB# rows (not other shots\', not unsettled ones)', async () => {
    mockQuery.mockResolvedValue({
      Items: [
        shotItem(1, 2, 5), candItem(1, 2, 'cd_1'),
        jobItem(1, 2, 'gj_a'), jobItem(1, 2, 'gj_b', { status: 'succeeded' }), jobItem(1, 2, 'gj_c', { status: 'cancelled' }),
        jobItem(1, 2, 'gj_unsettled', { settledAt: undefined }),
        jobItem(1, 3, 'gj_other'),
      ],
    });
    await repo.deleteShot(VS, 1, 2);
    expect(delSks()).toEqual(
      [shotSk(1, 2), candSk(1, 2, 'cd_1'), genJobSk('gj_a'), genJobSk('gj_b'), genJobSk('gj_c')].sort()
    );
  });

  it('deleteShot never deletes an in-flight job row', async () => {
    mockQuery.mockResolvedValue({
      Items: [shotItem(1, 2, 5), jobItem(1, 2, 'gj_r', { status: 'running', settledAt: undefined })],
    });
    await repo.deleteShot(VS, 1, 2);
    expect(delSks()).toEqual([shotSk(1, 2)]);
  });

  it('deleteScene deletes that scene\'s settled terminal GENJOB# rows', async () => {
    mockQuery.mockResolvedValue({
      Items: [sceneItem(1), shotItem(1, 1, 5), jobItem(1, 1, 'gj_a'), jobItem(2, 1, 'gj_other')],
    });
    await repo.deleteScene(VS, 1);
    expect(delSks()).toEqual([sceneSk(1), shotSk(1, 1), genJobSk('gj_a')].sort());
  });

  it('reorderShots deletes the moved shots\' settled terminal jobs after the transaction, outside it', async () => {
    mockQuery.mockResolvedValue({
      Items: [
        shotItem(1, 1, 5), shotItem(1, 2, 8), shotItem(1, 3, 2),
        jobItem(1, 1, 'gj_1'), jobItem(1, 2, 'gj_2'), jobItem(1, 3, 'gj_3'),
        jobItem(1, 3, 'gj_3u', { settledAt: undefined }),
      ],
    });
    await repo.reorderShots(VS, 1, [2, 1, 3]); // shots 1 and 2 swap; 3 stays
    const { puts, dels } = ops(mockTransact.mock.calls[0][0]);
    expect([...puts.map((p: any) => p.SK), ...dels.map((k: any) => k.SK)].some((sk: string) => sk.startsWith('GENJOB#'))).toBe(false);
    expect(delSks()).toEqual([genJobSk('gj_1'), genJobSk('gj_2')].sort());
    expect(mockTransact.mock.invocationCallOrder[0]).toBeLessThan(Math.min(...mockDelete.mock.invocationCallOrder));
  });

  it('applyDraft deletes every settled terminal GENJOB# row with the replaced shots\' candidates', async () => {
    mockGet.mockResolvedValue({
      PK, SK: draftSk('dr_1'), draftId: 'dr_1', lyricsHash: 'h', model: 'm', inputTokens: 1, outputTokens: 2,
      costUsd: 0.1, characters: [], createdAt: 't',
      scenes: [{ heading: 'S', summary: 's', shots: [{ durationSec: 5, mode: 'STILL', visualPrompt: 'v', characterNames: [] }] }],
    });
    mockQuery.mockResolvedValue({
      Items: [meta, shotItem(1, 1, 5), candItem(1, 1, 'cd_1'), jobItem(1, 1, 'gj_a'), jobItem(2, 4, 'gj_b'),
        jobItem(1, 1, 'gj_u', { settledAt: undefined })],
    });
    await repo.applyDraft(VS, 'dr_1');
    expect(delSks()).toEqual([candSk(1, 1, 'cd_1'), genJobSk('gj_a'), genJobSk('gj_b')].sort());
  });
});

describe('deleteScene', () => {
  it('deletes the scene, its shots and their candidates, and nothing from other scenes', async () => {
    mockQuery.mockResolvedValue({
      Items: [sceneItem(1), sceneItem(2), shotItem(1, 1, 5), shotItem(1, 2, 5), shotItem(2, 1, 5), candItem(1, 2, 'cd_1'), candItem(2, 1, 'cd_2')],
    });
    await repo.deleteScene(VS, 1);
    expect(mockTransact).not.toHaveBeenCalled();
    expect(mockDelete.mock.calls.map((c) => c[0].SK).sort()).toEqual(
      [sceneSk(1), shotSk(1, 1), shotSk(1, 2), candSk(1, 2, 'cd_1')].sort()
    );
  });

  it('a scene with 40 shots x 3 stills (160 items) is deleted, not refused', async () => {
    const items: any[] = [sceneItem(1)];
    for (let h = 1; h <= 40; h++) {
      items.push(shotItem(1, h, 1));
      for (let c = 0; c < 3; c++) items.push(candItem(1, h, `cd_${h}_${c}`));
    }
    mockQuery.mockResolvedValue({ Items: items });
    await repo.deleteScene(VS, 1);
    expect(mockDelete).toHaveBeenCalledTimes(161);
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
    await expect(repo.reorderShots(VS, 1, [1, 1])).rejects.toBeInstanceOf(InvalidReorderError);
    await expect(repo.reorderShots(VS, 1, [1])).rejects.toBeInstanceOf(InvalidReorderError);
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

  const delSks = () => mockDelete.mock.calls.map((c) => c[0].SK);

  it('writes 3 scenes + 8 shots + new characters, then deletes prior scenes/shots it did not overwrite', async () => {
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
    expect(dels).toHaveLength(0); // the transaction carries the new draft's puts only
    expect(puts.filter((p: any) => p.SK.startsWith('SCENE#'))).toHaveLength(3);
    expect(puts.filter((p: any) => p.SK.startsWith('SHOT#'))).toHaveLength(8);
    const chars = puts.filter((p: any) => p.SK.startsWith('CHAR#'));
    expect(chars.map((c: any) => c.name)).toEqual(['Ravi']); // Asha exists (case/space-insensitive)
    // prior scene 4 and shot 4#1 deleted; reused keys are overwritten, not deleted
    // (and the candidate of a replaced shot, so nothing is orphaned)
    expect(delSks().sort()).toEqual([sceneSk(4), shotSk(4, 1), candSk(1, 1, 'cd_1')].sort());
    // keys collide, so the old rows go only AFTER the new ones are written
    expect(mockTransact.mock.invocationCallOrder[0]).toBeLessThan(Math.min(...mockDelete.mock.invocationCallOrder));
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
    expect(delSks()).toEqual([candSk(1, 1, 'cd_1')]);
  });

  it('a story with 20 shots x 3 stills applies a 16-shot draft (existing pictures do not count)', async () => {
    const items: any[] = [meta];
    for (let sc = 1; sc <= 4; sc++) {
      items.push(sceneItem(sc));
      for (let h = 1; h <= 5; h++) {
        items.push(shotItem(sc, h, 3));
        for (let c = 0; c < 3; c++) items.push(candItem(sc, h, `cd_${sc}${h}${c}`));
      }
    }
    mockGet.mockResolvedValue({ PK, SK: draftSk('dr_1'), ...draft(4, [4, 4, 4, 4]) });
    mockQuery.mockResolvedValue({ Items: items }); // 4 + 20 + 60 = 84 old rows
    await repo.applyDraft(VS, 'dr_1');
    expect(mockTransact.mock.calls[0][0]).toHaveLength(20); // 4 scenes + 16 shots
    // 60 stills + shot 1..4#5 (not overwritten) are removed; overwritten keys are not deleted
    expect(mockDelete).toHaveBeenCalledTimes(64);
    expect(delSks().filter((k) => k.startsWith('CAND#'))).toHaveLength(60);
  });

  it('throws DraftTooLargeError when the draft itself needs more than 100 writes, naming what is too large', async () => {
    mockGet.mockResolvedValue({ PK, SK: draftSk('dr_1'), ...draft(10, Array(10).fill(10)) }); // 10 + 100 = 110
    mockQuery.mockResolvedValue({ Items: [meta] });
    const err = await repo.applyDraft(VS, 'dr_1').catch((e) => e);
    expect(err).toBeInstanceOf(DraftTooLargeError);
    expect(err.itemCount).toBe(110);
    expect(err.message).toBe(
      'This draft has too many scenes, shots and new characters to apply (110; the limit is 100). Draft again for fewer shots.'
    );
    expect(mockTransact).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('still wraps genuine storage failures', async () => {
    mockGet.mockRejectedValue(Object.assign(new Error('boom'), { name: 'InternalServerError' }));
    await expect(repo.applyDraft(VS, 'dr_1')).rejects.toMatchObject({ statusCode: 500 });
  });

  it('allows exactly 100 puts, however many old rows there are', async () => {
    mockGet.mockResolvedValue({ PK, SK: draftSk('dr_1'), ...draft(10, Array(10).fill(9)) });
    const old = Array.from({ length: 50 }, (_, i) => candItem(12, 1, `cd_${i}`));
    mockQuery.mockResolvedValue({ Items: [meta, ...old] });
    await repo.applyDraft(VS, 'dr_1');
    expect(mockTransact.mock.calls[0][0]).toHaveLength(100);
    expect(mockDelete).toHaveBeenCalledTimes(50);
  });

  it('a failed write leaves the old storyboard untouched (nothing deleted)', async () => {
    mockGet.mockResolvedValue({ PK, SK: draftSk('dr_1'), ...draft(1, [1]) });
    mockQuery.mockResolvedValue({ Items: [meta, shotItem(2, 1, 5)] });
    mockTransact.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'TransactionCanceledException' }));
    await expect(repo.applyDraft(VS, 'dr_1')).rejects.toMatchObject({ statusCode: 500 });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('throws when the draft is missing', async () => {
    mockGet.mockResolvedValue(undefined);
    await expect(repo.applyDraft(VS, 'dr_x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('draft jobs', () => {
  const job = { jobId: 'dj_1730000000000_abcdef12', status: 'queued', createdAt: 't0', updatedAt: 't0', reservedUsd: 0.1 };

  it('createDraftJob writes DRAFTJOB#<jobId> in the story partition', async () => {
    await repo.createDraftJob(VS, job as any);
    expect(mockPut).toHaveBeenCalledWith({ PK, SK: draftJobSk(job.jobId), ...job });
    expect(draftJobSk('dj_x')).toBe('DRAFTJOB#dj_x');
  });

  it('listDraftJobs queries DRAFTJOB# only (never DRAFT# drafts), follows pagination, strips keys', async () => {
    mockQuery
      .mockResolvedValueOnce({ Items: [{ PK, SK: draftJobSk('dj_a'), ...job, jobId: 'dj_a' }], LastEvaluatedKey: { PK, SK: 'x' } })
      .mockResolvedValueOnce({ Items: [{ PK, SK: draftJobSk('dj_b'), ...job, jobId: 'dj_b' }] });
    const jobs = await repo.listDraftJobs(VS);
    expect(jobs.map((j) => j.jobId)).toEqual(['dj_a', 'dj_b']);
    expect(jobs[0]).not.toHaveProperty('PK');
    const q = mockQuery.mock.calls[0][0];
    expect(q.keyConditionExpression).toBe('PK = :pk AND begins_with(SK, :sk)');
    expect(q.expressionAttributeValues).toEqual({ ':pk': PK, ':sk': 'DRAFTJOB#' });
    expect(mockQuery.mock.calls[1][0].exclusiveStartKey).toEqual({ PK, SK: 'x' });
  });

  it('loadTree keeps job rows out of drafts', async () => {
    mockQuery.mockResolvedValue({ Items: [meta, { PK, SK: draftJobSk('dj_a'), ...job }, { PK, SK: draftSk('dr_1'), draftId: 'dr_1' }] });
    const tree = await repo.loadTree(VS);
    expect(tree!.drafts.map((d: any) => d.draftId)).toEqual(['dr_1']);
  });

  it('getDraftJob strips keys; null when absent', async () => {
    mockGet.mockResolvedValueOnce({ PK, SK: draftJobSk(job.jobId), ...job });
    expect(await repo.getDraftJob(VS, job.jobId)).toEqual(job);
    mockGet.mockResolvedValueOnce(undefined);
    expect(await repo.getDraftJob(VS, job.jobId)).toBeNull();
  });

  it('transitionDraftJob is conditional on the current status and returns the new job', async () => {
    mockUpdate.mockResolvedValueOnce({ PK, SK: draftJobSk(job.jobId), ...job, status: 'done', draftId: 'dr_1' } as any);
    const out = await repo.transitionDraftJob(VS, job.jobId, ['running'], 'done', { draftId: 'dr_1' });
    expect(out).toMatchObject({ jobId: job.jobId, status: 'done', draftId: 'dr_1' });
    expect(out).not.toHaveProperty('PK');
    const p = mockUpdate.mock.calls[0][0];
    expect(p.key).toEqual({ PK, SK: draftJobSk(job.jobId) });
    expect(p.conditionExpression).toBe('attribute_exists(PK) AND #s IN (:from0)');
    expect(p.expressionAttributeValues).toMatchObject({ ':from0': 'running', ':to': 'done', ':draftId': 'dr_1' });
  });

  it('accepts several from-states', async () => {
    mockUpdate.mockResolvedValueOnce({ ...job, status: 'failed' } as any);
    await repo.transitionDraftJob(VS, job.jobId, ['queued', 'running'], 'failed', { code: 'timeout', error: 'e' });
    const p = mockUpdate.mock.calls[0][0];
    expect(p.conditionExpression).toBe('attribute_exists(PK) AND #s IN (:from0, :from1)');
    expect(p.expressionAttributeValues).toMatchObject({ ':from0': 'queued', ':from1': 'running', ':code': 'timeout', ':error': 'e' });
  });

  it('returns null when the job is no longer in a from-state (someone else finished it)', async () => {
    mockUpdate.mockRejectedValueOnce(Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' }));
    expect(await repo.transitionDraftJob(VS, job.jobId, ['queued'], 'running')).toBeNull();
  });

  it('wraps other storage failures', async () => {
    mockUpdate.mockRejectedValueOnce(Object.assign(new Error('c'), { name: 'InternalServerError' }));
    await expect(repo.transitionDraftJob(VS, job.jobId, ['queued'], 'running')).rejects.toMatchObject({ statusCode: 500 });
  });
});
