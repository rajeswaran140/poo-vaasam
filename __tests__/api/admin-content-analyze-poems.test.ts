/** @jest-environment node */
/**
 * POST /api/admin/content/analyze-poems — precompute + store the emotion
 * analysis. The repository and analyzer are mocked; we assert single-id vs
 * backfill behaviour, that only poems MISSING an analysis are (re)done, and that
 * a per-item failure doesn't abort the batch.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const requireAdmin = jest.fn();
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
  // Real implementation, so the Bearer/CSRF gate is genuinely exercised rather
  // than stubbed out (an undefined stub throws and reads as a 401 either way,
  // which would pass the CSRF test for the wrong reason).
  requireBearer: jest.requireActual('@/lib/auth-helper').requireBearer,
  authErrorResponse: () => new Response('unauthorized', { status: 401 }),
}));

const mockAnalyze = jest.fn();
jest.mock('@/services/ai/poem-emotion', () => ({
  analyzePoemEmotion: (...a: unknown[]) => mockAnalyze(...a),
  isPoemAnalysisConfigured: () => true,
}));

const findById = jest.fn();
const findByType = jest.fn();
const save = jest.fn();
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({ findById, findByType, save })),
}));

import { POST } from '@/app/api/admin/content/analyze-poems/route';

const analysis = {
  emotion: 'reflective',
  mood: 'gentle',
  themes: ['x'],
  musicRecommendation: 'peaceful_ambient',
  ttsSpeed: 1,
  ttsPitch: 1,
  summary: 's',
};

function makeContent(id: string, hasAnalysis = false) {
  return {
    id,
    title: 't',
    body: 'b',
    author: 'a',
    emotionAnalysis: hasAnalysis ? analysis : undefined,
    setEmotionAnalysis: jest.fn(),
  };
}

const post = (body: unknown, withBearer = true) =>
  POST(
    new NextRequest('https://tamilagaval.com/api/admin/content/analyze-poems', {
      method: 'POST',
      headers: withBearer
        ? { 'content-type': 'application/json', Authorization: 'Bearer test-token' }
        : { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ email: 'admin@x' });
  mockAnalyze.mockResolvedValue(analysis);
});

it('401s when the caller is not an admin', async () => {
  requireAdmin.mockRejectedValueOnce(new Error('nope'));
  expect((await post({ id: 'cnt_abc' })).status).toBe(401);
});

it('401s without a Bearer token (CSRF defense on the mutation)', async () => {
  expect((await post({ id: 'cnt_abc' }, false)).status).toBe(401);
  expect(mockAnalyze).not.toHaveBeenCalled();
});

it('analyzes and stores a single poem by id', async () => {
  const c = makeContent('cnt_abc');
  findById.mockResolvedValue(c);

  const res = await post({ id: 'cnt_abc' });
  const json = await res.json();

  expect(res.status).toBe(200);
  expect(c.setEmotionAnalysis).toHaveBeenCalledWith(analysis);
  expect(save).toHaveBeenCalledWith(c);
  expect(json.analyzed).toEqual([{ id: 'cnt_abc', emotion: 'reflective' }]);
});

it('404s when the id is not found', async () => {
  findById.mockResolvedValue(null);
  expect((await post({ id: 'cnt_missing' })).status).toBe(404);
});

it('backfills only poems missing an analysis', async () => {
  const withA = makeContent('cnt_has', true);
  const noA1 = makeContent('cnt_no1');
  const noA2 = makeContent('cnt_no2');
  findByType.mockResolvedValue({ items: [withA, noA1, noA2], total: 3, limit: 100, hasMore: false });

  const json = await (await post({})).json();

  expect(json.analyzed.map((a: { id: string }) => a.id).sort()).toEqual(['cnt_no1', 'cnt_no2']);
  expect(withA.setEmotionAnalysis).not.toHaveBeenCalled();
  expect(noA1.setEmotionAnalysis).toHaveBeenCalledWith(analysis);
  expect(save).toHaveBeenCalledTimes(2);
  expect(json.remaining).toBe(0);
});

it('force re-analyzes poems that already have an analysis', async () => {
  const withA = makeContent('cnt_has', true);
  findByType.mockResolvedValue({ items: [withA], total: 1, limit: 100, hasMore: false });

  await post({ force: true });
  expect(withA.setEmotionAnalysis).toHaveBeenCalledWith(analysis);
});

it('collects per-item failures without aborting the batch', async () => {
  const a = makeContent('cnt_a');
  const b = makeContent('cnt_b');
  findByType.mockResolvedValue({ items: [a, b], total: 2, limit: 100, hasMore: false });
  mockAnalyze.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(analysis);

  const json = await (await post({})).json();

  expect(json.failed).toEqual([{ id: 'cnt_a' }]);
  expect(json.analyzed).toEqual([{ id: 'cnt_b', emotion: 'reflective' }]);
  expect(save).toHaveBeenCalledTimes(1);
});
