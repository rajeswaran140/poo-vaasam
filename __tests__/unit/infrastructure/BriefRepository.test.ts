/** @jest-environment node */
/**
 * Tests for BriefRepository — save/findById/list against a mocked
 * DynamoDBOperations. Verifies the single-table item shape (PK/SK/GSI1),
 * provenance stamping, and newest-first listing.
 */

jest.mock('@/services/ai/composer', () => ({ DEFAULT_MODEL: 'claude-test-model' }));

const put = jest.fn();
const get = jest.fn();
const query = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    put: (...a: unknown[]) => put(...a),
    get: (...a: unknown[]) => get(...a),
    query: (...a: unknown[]) => query(...a),
  },
  handleDynamoDBError: (e: unknown) => {
    throw e;
  },
}));

import { BriefRepository } from '@/infrastructure/database/BriefRepository';

const analysis = {
  emotion: 'அன்னை',
  emotion_breakdown: ['அன்னை', 'ஏக்கம்'],
  mood: 'Tender',
  theme: 'Mother',
  suggested_key: 'D Minor',
  suggested_bpm: 68,
  suggested_instruments: ['Flute', 'Veena'],
  recommended_voice: ['Female Adult'],
  song_titles: ['T1'],
  suno_prompts: [{ style: 'Traditional Tamil', prompt: 'p' }],
  thumbnail_prompt: 'tp',
  youtube_description_tamil: 'தமிழ்',
  youtube_description_english: 'english',
  reel: { hook: 'h', caption: 'c', hashtags: ['#x'] },
};

const repo = new BriefRepository();

beforeEach(() => {
  put.mockReset();
  get.mockReset();
  query.mockReset();
});

describe('save', () => {
  it('persists a single-table item (PK/SK/GSI1) and stamps provenance + empty outcome/embedding', async () => {
    put.mockResolvedValue({});
    const brief = await repo.save({
      lyrics: 'அரிதான பெரும் பாசம்',
      analysis: analysis as never,
      decision: { chosenSunoStyle: 'Traditional Tamil' },
    });

    expect(put).toHaveBeenCalledTimes(1);
    const item = put.mock.calls[0][0];
    expect(item.PK).toBe(`BRIEF#${brief.id}`);
    expect(item.SK).toBe('METADATA');
    expect(item.Type).toBe('BRIEF');
    expect(item.GSI1PK).toBe('BRIEF#ALL');
    expect(item.GSI1SK).toBe(`${brief.createdAt}#${brief.id}`);
    // provenance from the composer's configured model
    expect(item.model).toBe('claude-test-model');
    expect(item.decision).toEqual({ chosenSunoStyle: 'Traditional Tamil' });
    expect(item.outcome).toBeNull();
    expect(item.embedding).toBeNull();
    expect(item.analysis.emotion).toBe('அன்னை');
    expect(brief.id).toMatch(/^brief_/);
  });

  it('defaults decision to {} when none provided', async () => {
    put.mockResolvedValue({});
    const brief = await repo.save({ lyrics: 'x', analysis: analysis as never });
    expect(brief.decision).toEqual({});
  });
});

describe('findById', () => {
  it('returns the brief when present', async () => {
    get.mockResolvedValue({ id: 'brief_1', createdAt: 't', updatedAt: 't', lyrics: 'l', analysis, model: 'm', decision: {}, outcome: null, embedding: null });
    const b = await repo.findById('brief_1');
    expect(get).toHaveBeenCalledWith({ PK: 'BRIEF#brief_1', SK: 'METADATA' });
    expect(b?.id).toBe('brief_1');
    expect(b?.analysis.emotion).toBe('அன்னை');
  });

  it('returns null when not found', async () => {
    get.mockResolvedValue(undefined);
    expect(await repo.findById('nope')).toBeNull();
  });
});

describe('list', () => {
  it('queries GSI1 (BRIEF#ALL) newest-first and maps items', async () => {
    query.mockResolvedValue({ Items: [{ id: 'brief_2', createdAt: 't2', updatedAt: 't2', lyrics: 'l', analysis, model: 'm', decision: {}, outcome: null, embedding: null }] });
    const items = await repo.list({ limit: 10 });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        indexName: 'GSI1',
        keyConditionExpression: 'GSI1PK = :pk',
        expressionAttributeValues: { ':pk': 'BRIEF#ALL' },
        scanIndexForward: false,
        limit: 10,
      })
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('brief_2');
  });
});
