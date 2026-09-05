/** @jest-environment node */
/**
 * SunoPromptRepository — GSI1-backed listing (paginated query, not a scan),
 * and the audio-influence invariant surviving a round trip through DynamoDB.
 *
 * The invariant is the point: Suno only offers Audio Influence with an audio
 * upload, so a prompt that is not using one must come back with no
 * audioInfluence at all — not 0, which would read as a deliberate "none".
 */

const mockGet = jest.fn();
const mockPut = jest.fn();
const mockQuery = jest.fn();
const mockDelete = jest.fn();
// Arrow wrappers defer the const access so the hoisted factory doesn't hit the TDZ.
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    get: (...a: unknown[]) => mockGet(...a),
    put: (...a: unknown[]) => mockPut(...a),
    query: (...a: unknown[]) => mockQuery(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
  handleDynamoDBError: (e: unknown) => { throw e; },
}));

import { SunoPromptRepository } from '@/infrastructure/database/SunoPromptRepository';

const repo = new SunoPromptRepository();

const input = (over: Record<string, unknown> = {}) => ({
  title: 'Enna Idhu Kadhalā — folk take',
  lyrics: 'என்ன இது காதலா',
  style: 'Tamil village folk',
  styleBox: 'tamil folk, thavil, warm male lead',
  exclude: ['autotune'],
  lyricsBlock: '[Verse - flute intro]\nஎன்ன இது காதலா',
  weirdness: 50,
  styleInfluence: 80,
  usesAudioUpload: false,
  ...over,
});

const dbItem = (over: Record<string, unknown> = {}) => ({
  id: 'snp_1',
  ...input(),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('create', () => {
  it('writes the single-table keys and GSI1 attributes for cheap listing', async () => {
    mockPut.mockResolvedValueOnce({});
    const saved = await repo.create(input());
    const item = mockPut.mock.calls[0][0];
    expect(item.PK).toBe(`SUNOPROMPT#${saved.id}`);
    expect(item.SK).toBe('METADATA');
    expect(item.Type).toBe('SUNO_PROMPT');
    expect(item.GSI1PK).toBe('SUNO_PROMPT');
  });

  it('sorts newest first by putting the timestamp in the GSI1 sort key', async () => {
    mockPut.mockResolvedValueOnce({});
    const saved = await repo.create(input());
    const item = mockPut.mock.calls[0][0];
    expect(item.GSI1SK).toBe(`${saved.createdAt.toISOString()}#${saved.id}`);
  });

  it('does NOT persist audioInfluence when the prompt uses no audio upload', async () => {
    mockPut.mockResolvedValueOnce({});
    await repo.create(input({ usesAudioUpload: false }));
    const item = mockPut.mock.calls[0][0];
    expect(item.audioInfluence).toBeUndefined();
  });

  it('persists audioInfluence when the prompt does use an audio upload', async () => {
    mockPut.mockResolvedValueOnce({});
    await repo.create(input({ usesAudioUpload: true, audioInfluence: 35 }));
    const item = mockPut.mock.calls[0][0];
    expect(item.audioInfluence).toBe(35);
  });
});

describe('findAll', () => {
  it('queries GSI1 rather than scanning the table', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [dbItem()], LastEvaluatedKey: undefined });
    await repo.findAll();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0].indexName).toBe('GSI1');
  });

  it('follows pagination until the last page', async () => {
    mockQuery
      .mockResolvedValueOnce({ Items: [dbItem({ id: 'snp_1' })], LastEvaluatedKey: { PK: 'x' } })
      .mockResolvedValueOnce({ Items: [dbItem({ id: 'snp_2' })], LastEvaluatedKey: undefined });
    const all = await repo.findAll();
    expect(all.map((p) => p.id)).toEqual(['snp_1', 'snp_2']);
  });

  it('revives timestamps as Dates, not strings', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [dbItem()], LastEvaluatedKey: undefined });
    const [p] = await repo.findAll();
    expect(p.createdAt).toBeInstanceOf(Date);
  });

  it('leaves audioInfluence undefined for a stored lyrics-only prompt', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [dbItem()], LastEvaluatedKey: undefined });
    const [p] = await repo.findAll();
    expect(p.audioInfluence).toBeUndefined();
    expect(p.usesAudioUpload).toBe(false);
  });
});

describe('findById', () => {
  it('returns null when the prompt is absent', async () => {
    mockGet.mockResolvedValueOnce(undefined);
    expect(await repo.findById('nope')).toBeNull();
  });
});

describe('update', () => {
  it('drops a stored audioInfluence when audio upload is turned off', async () => {
    mockGet.mockResolvedValueOnce(dbItem({ usesAudioUpload: true, audioInfluence: 40 }));
    mockPut.mockResolvedValueOnce({});
    const updated = await repo.update('snp_1', { usesAudioUpload: false });
    expect(updated?.audioInfluence).toBeUndefined();
    expect(mockPut.mock.calls[0][0].audioInfluence).toBeUndefined();
  });

  it('moves updatedAt forward but leaves createdAt alone', async () => {
    const item = dbItem();
    mockGet.mockResolvedValueOnce(item);
    mockPut.mockResolvedValueOnce({});
    const updated = await repo.update('snp_1', { title: 'renamed' });
    expect(updated?.createdAt.toISOString()).toBe(item.createdAt);
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(new Date(item.updatedAt).getTime());
  });

  it('returns null for a prompt that does not exist', async () => {
    mockGet.mockResolvedValueOnce(undefined);
    expect(await repo.update('nope', { title: 'x' })).toBeNull();
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('delete', () => {
  it('deletes by the composite key', async () => {
    mockGet.mockResolvedValueOnce(dbItem());
    mockDelete.mockResolvedValueOnce({});
    await repo.delete('snp_1');
    expect(mockDelete).toHaveBeenCalledWith({ PK: 'SUNOPROMPT#snp_1', SK: 'METADATA' });
  });
});
