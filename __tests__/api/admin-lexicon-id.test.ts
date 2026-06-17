/** @jest-environment node */
/** PUT/DELETE /api/admin/lexicon/[id] — gate, bad id, 404, update, delete. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockUpdate = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/infrastructure/database/LexiconRepository', () => ({
  LexiconRepository: jest.fn().mockImplementation(() => ({ update: mockUpdate, delete: mockDelete })),
}));

import { PUT, DELETE } from '@/app/api/admin/lexicon/[id]/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const req = (b: unknown = {}, id = 'lex_1') =>
  new NextRequest(`https://tamilagaval.com/api/admin/lexicon/${id}`, { method: 'PUT', body: JSON.stringify(b) });
const delReq = (id = 'lex_1') => new NextRequest(`https://tamilagaval.com/api/admin/lexicon/${id}`, { method: 'DELETE' });
const ctx = (id = 'lex_1') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true });
});

it('PUT 403 for non-admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await PUT(req({ usage: 'retire' }), ctx())).status).toBe(403);
});

it('PUT 400 on a malformed id', async () => {
  const res = await PUT(req({ usage: 'retire' }, 'bad'), ctx('bad'));
  expect(res.status).toBe(400);
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('PUT 400 on an empty update', async () => {
  expect((await PUT(req({}), ctx())).status).toBe(400);
});

it('PUT 404 when the word is missing', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockUpdate.mockRejectedValueOnce(new Error('Lexicon word lex_1 not found'));
  expect((await PUT(req({ usage: 'retire' }), ctx())).status).toBe(404);
});

it('PUT 409 when a rename collides with an existing headword', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockUpdate.mockRejectedValueOnce(Object.assign(new Error('Word already exists'), { code: 'DUPLICATE_WORD' }));
  const res = await PUT(req({ word: 'நிலா' }), ctx());
  expect(res.status).toBe(409);
});

it('PUT updates and returns the word', async () => {
  mockUpdate.mockResolvedValueOnce({ id: 'lex_1', usage: 'retire' });
  const res = await PUT(req({ usage: 'retire' }), ctx());
  expect(res.status).toBe(200);
  expect((await res.json()).data.usage).toBe('retire');
  expect(mockUpdate).toHaveBeenCalledWith('lex_1', { usage: 'retire' });
});

it('DELETE removes the word', async () => {
  mockDelete.mockResolvedValueOnce(undefined);
  const res = await DELETE(delReq(), ctx());
  expect(res.status).toBe(200);
  expect(mockDelete).toHaveBeenCalledWith('lex_1');
});
