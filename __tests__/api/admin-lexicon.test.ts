/** @jest-environment node */
/** GET/POST /api/admin/lexicon — admin gate, filtering, validation, dedupe. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockFindAll = jest.fn();
const mockFindByWord = jest.fn();
const mockCreate = jest.fn();
jest.mock('@/infrastructure/database/LexiconRepository', () => ({
  LexiconRepository: jest.fn().mockImplementation(() => ({
    findAll: mockFindAll,
    findByWord: mockFindByWord,
    create: mockCreate,
  })),
}));

import { GET, POST } from '@/app/api/admin/lexicon/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const BEARER = { Authorization: 'Bearer test-token' };
const get = (qs = '') => GET(new NextRequest(`https://tamilagaval.com/api/admin/lexicon${qs}`));
const post = (b: unknown, withBearer = true) =>
  POST(new NextRequest('https://tamilagaval.com/api/admin/lexicon', {
    method: 'POST',
    body: JSON.stringify(b),
    headers: withBearer ? BEARER : undefined,
  }));

const WORDS = [
  { id: 'lex_1', word: 'நிலா', gloss: 'moon', register: 'literary', usage: 'fresh', themes: ['love'], usageCount: 0, archived: false },
  { id: 'lex_2', word: 'கடல்', gloss: 'sea', register: 'sangam', usage: 'retire', themes: ['nature'], usageCount: 0, archived: false },
  { id: 'lex_3', word: 'பழசு', gloss: 'old', register: 'village', usage: 'neutral', themes: [], usageCount: 0, archived: true },
];

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true });
  mockFindAll.mockResolvedValue(WORDS);
});

it('GET returns 403 for a non-admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await get()).status).toBe(403);
});

it('GET lists non-archived words by default', async () => {
  const body = await (await get()).json();
  expect(body.total).toBe(2); // lex_3 archived → hidden
});

it('GET filters by register', async () => {
  const body = await (await get('?register=sangam')).json();
  expect(body.data.map((w: { id: string }) => w.id)).toEqual(['lex_2']);
});

it('GET ?archived=true includes archived', async () => {
  const body = await (await get('?archived=true')).json();
  expect(body.total).toBe(3);
});

it('POST returns 401 without a Bearer token (CSRF defense on the mutation)', async () => {
  const res = await post({ word: 'வான்', gloss: 'sky', register: 'literary' }, false);
  expect(res.status).toBe(401);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('POST rejects an invalid word (400)', async () => {
  const res = await post({ word: '', gloss: '', register: 'literary' });
  expect(res.status).toBe(400);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('POST returns 409 when the headword already exists', async () => {
  mockFindByWord.mockResolvedValueOnce(WORDS[0]);
  const res = await post({ word: 'நிலா', gloss: 'moon', register: 'literary' });
  expect(res.status).toBe(409);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('POST creates a new word (201)', async () => {
  mockFindByWord.mockResolvedValueOnce(null);
  mockCreate.mockResolvedValueOnce({ id: 'lex_9', word: 'வான்', gloss: 'sky', register: 'literary', usage: 'fresh', themes: [], usageCount: 0, archived: false });
  const res = await post({ word: 'வான்', gloss: 'sky', register: 'literary' });
  expect(res.status).toBe(201);
  expect((await res.json()).data.id).toBe('lex_9');
  expect(mockCreate).toHaveBeenCalledTimes(1);
});
