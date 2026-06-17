/** @jest-environment node */
/** POST /api/admin/lexicon/suggest + /bulk — gate, 503, dedupe on bulk-accept. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockFindAll = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/infrastructure/database/LexiconRepository', () => ({
  LexiconRepository: jest.fn().mockImplementation(() => ({ findAll: mockFindAll, create: mockCreate })),
}));

const mockIsConfigured = jest.fn();
const mockSuggest = jest.fn();
jest.mock('@/services/ai/lexicon-suggest', () => ({
  isLexiconAiConfigured: () => mockIsConfigured(),
  suggestLexiconWords: (...a: unknown[]) => mockSuggest(...a),
}));

import { POST as SUGGEST } from '@/app/api/admin/lexicon/suggest/route';
import { POST as BULK } from '@/app/api/admin/lexicon/bulk/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const suggestReq = (b: unknown) => new NextRequest('https://tamilagaval.com/api/admin/lexicon/suggest', { method: 'POST', body: JSON.stringify(b) });
const bulkReq = (b: unknown) => new NextRequest('https://tamilagaval.com/api/admin/lexicon/bulk', { method: 'POST', body: JSON.stringify(b) });

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockFindAll.mockResolvedValue([]);
});

describe('suggest', () => {
  it('returns 503 when the AI key is not configured', async () => {
    mockIsConfigured.mockReturnValue(false);
    const res = await SUGGEST(suggestReq({ register: 'sangam', count: 5 }));
    expect(res.status).toBe(503);
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it('returns suggestions and passes existing words as avoid', async () => {
    mockIsConfigured.mockReturnValue(true);
    mockFindAll.mockResolvedValueOnce([{ word: 'கடல்' }]);
    mockSuggest.mockResolvedValueOnce([{ word: 'நிலா', gloss: 'moon', register: 'sangam', themes: [], usage: 'fresh' }]);
    const res = await SUGGEST(suggestReq({ register: 'sangam', theme: 'nature', count: 5 }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
    expect(mockSuggest).toHaveBeenCalledWith(expect.objectContaining({ register: 'sangam', avoid: ['கடல்'] }));
  });
});

describe('bulk', () => {
  it('creates new words and skips ones that already exist', async () => {
    mockFindAll.mockResolvedValueOnce([{ word: 'கடல்' }]); // already known
    mockCreate.mockResolvedValue(undefined);
    const res = await BULK(bulkReq({ words: [
      { word: 'நிலா', gloss: 'moon', register: 'sangam', usage: 'fresh', themes: [] },
      { word: 'கடல்', gloss: 'sea', register: 'sangam', usage: 'fresh', themes: [] }, // dup vs existing
      { word: 'நிலா', gloss: 'moon2', register: 'sangam', usage: 'fresh', themes: [] }, // dup within batch
    ] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toBe(1);
    expect(body.skipped).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty batch (400)', async () => {
    expect((await BULK(bulkReq({ words: [] }))).status).toBe(400);
  });
});
