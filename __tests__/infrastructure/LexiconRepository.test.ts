/** @jest-environment node */
/**
 * LexiconRepository — GSI1-backed listing (paginated query, not a scan),
 * exact findByWord via begins_with, GSI attributes on write, and the
 * rename-uniqueness guard.
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

import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';

const repo = new LexiconRepository();
const dbItem = (over: Record<string, unknown> = {}) => ({
  id: 'lex_1', word: 'நிலா', gloss: 'moon', register: 'literary', usage: 'fresh',
  themes: ['love'], usageCount: 0, archived: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('create', () => {
  it('writes GSI1 attributes for cheap listing', async () => {
    mockPut.mockResolvedValueOnce({});
    await repo.create({ word: 'வான்', gloss: 'sky', register: 'literary', usage: 'fresh', themes: [] });
    const item = mockPut.mock.calls[0][0];
    expect(item.GSI1PK).toBe('LEXICON');
    expect(item.GSI1SK).toBe(`வான்#${item.id}`);
    expect(item.Type).toBe('LEXICON');
  });
});

describe('findAll', () => {
  it('queries GSI1 (not scan) and follows pagination', async () => {
    mockQuery
      .mockResolvedValueOnce({ Items: [dbItem({ id: 'lex_1', word: 'அ' })], LastEvaluatedKey: { k: 1 } })
      .mockResolvedValueOnce({ Items: [dbItem({ id: 'lex_2', word: 'ஆ' })] });
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0]).toMatchObject({ indexName: 'GSI1', expressionAttributeValues: { ':pk': 'LEXICON' } });
    expect(mockQuery.mock.calls[1][0].exclusiveStartKey).toEqual({ k: 1 });
  });
});

describe('findByWord', () => {
  it('does an exact GSI1 lookup via begins_with(`<word>#`)', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [dbItem({ word: 'நிலா' })] });
    const w = await repo.findByWord('நிலா');
    expect(w?.word).toBe('நிலா');
    const params = mockQuery.mock.calls[0][0];
    expect(params.indexName).toBe('GSI1');
    expect(params.keyConditionExpression).toContain('begins_with(GSI1SK, :sk)');
    expect(params.expressionAttributeValues[':sk']).toBe('நிலா#');
  });

  it('returns null when nothing matches', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [] });
    expect(await repo.findByWord('x')).toBeNull();
  });
});

describe('update — rename uniqueness', () => {
  it('throws DUPLICATE_WORD when the new headword belongs to another item', async () => {
    mockGet.mockResolvedValueOnce(dbItem({ id: 'lex_1', word: 'old' }));      // findById
    mockQuery.mockResolvedValueOnce({ Items: [dbItem({ id: 'lex_2', word: 'நிலா' })] }); // findByWord clash
    await expect(repo.update('lex_1', { word: 'நிலா' })).rejects.toMatchObject({ code: 'DUPLICATE_WORD' });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('allows a rename to a free headword (writes through)', async () => {
    mockGet.mockResolvedValueOnce(dbItem({ id: 'lex_1', word: 'old' }));
    mockQuery.mockResolvedValueOnce({ Items: [] }); // no clash
    mockPut.mockResolvedValueOnce({});
    const updated = await repo.update('lex_1', { word: 'புதிது' });
    expect(updated.word).toBe('புதிது');
    expect(mockPut).toHaveBeenCalledTimes(1);
  });

  it('skips the uniqueness query when the word is unchanged', async () => {
    mockGet.mockResolvedValueOnce(dbItem({ id: 'lex_1', word: 'நிலா' }));
    mockPut.mockResolvedValueOnce({});
    await repo.update('lex_1', { usage: 'retire' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

/**
 * ⚠️ THE 1,047 ROWS ALREADY IN THE TABLE. Every field added by the literary
 * lexicon work postdates them, and none of them are being back-filled — so
 * reading a legacy item must produce a complete, valid word without inventing
 * anything. These tests are the contract that keeps the live data readable.
 */
describe('reading a legacy row written before the literary fields existed', () => {
  const legacy = () =>
    dbItem({
      // Exactly what a 2026-08 row looks like: a scalar register, the old
      // freshness vocabulary, and none of the new attributes at all.
      register: 'sangam',
      usage: 'neutral',
      registers: undefined,
      normalizedWord: undefined,
      moods: undefined,
      synonyms: undefined,
      examples: undefined,
    });

  it('derives registers from the legacy scalar without changing it', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [legacy()] });
    const [w] = await repo.findAll();
    expect(w.registers).toEqual(['sangam']);
    expect(w.register).toBe('sangam');
  });

  it('maps the retired usage value forward', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [legacy()] });
    const [w] = await repo.findAll();
    expect(w.usage).toBe('normal');
  });

  it('derives the match key on the fly, so search works with no migration pass', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [legacy()] });
    const [w] = await repo.findAll();
    expect(w.normalizedWord).toBe('நிலா');
  });

  it('returns empty arrays, never undefined, for the new relation fields', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [legacy()] });
    const [w] = await repo.findAll();
    for (const key of ['moods', 'synonyms', 'relatedWords', 'antonyms', 'etukai', 'monai', 'rhymesWith', 'semanticFamily', 'examples'] as const) {
      expect(Array.isArray(w[key])).toBe(true);
      expect(w[key]).toEqual([]);
    }
  });

  it('leaves confidence ABSENT rather than defaulting it — absence is the signal that nobody reviewed the row', async () => {
    mockQuery.mockResolvedValueOnce({ Items: [legacy()] });
    const [w] = await repo.findAll();
    expect(w.confidence).toBeUndefined();
    expect(w.lexicalStatus).toBeUndefined();
    expect(w.wordType).toBeUndefined();
  });
});

describe('writing keeps the legacy shape readable', () => {
  it('writes the scalar `register` alongside `registers`, so a rollback still reads the row', async () => {
    mockPut.mockResolvedValueOnce({});
    await repo.create({
      word: 'அன்பு', gloss: 'love', registers: ['common', 'literary'], register: 'common',
      usage: 'fresh', themes: [],
    });
    const item = mockPut.mock.calls[0][0];
    expect(item.register).toBe('common');
    expect(item.registers).toEqual(['common', 'literary']);
  });

  it('stores the derived match key', async () => {
    mockPut.mockResolvedValueOnce({});
    await repo.create({ word: 'அன்‌பு', gloss: 'love', registers: ['common'], register: 'common', usage: 'fresh', themes: [] });
    expect(mockPut.mock.calls[0][0].normalizedWord).toBe('அன்பு');
  });

  it('rebuilds the match key when the word is renamed', async () => {
    mockGet.mockResolvedValueOnce(dbItem());
    mockQuery.mockResolvedValueOnce({ Items: [] });
    mockPut.mockResolvedValueOnce({});
    await repo.update('lex_1', { word: 'வைகறை' });
    const item = mockPut.mock.calls[0][0];
    expect(item.word).toBe('வைகறை');
    expect(item.normalizedWord).toBe('வைகறை');
  });
});
