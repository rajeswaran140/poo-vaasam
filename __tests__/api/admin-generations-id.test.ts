/** @jest-environment node */
/**
 * DELETE /api/admin/generations/[id] — admin-gated removal. Proves auth
 * short-circuits, the briefId requirement, success, and error handling.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
  requireBearer: jest.fn(),
}));

const mockDelete = jest.fn();
jest.mock('@/infrastructure/database/GenerationRepository', () => ({
  GenerationRepository: jest.fn().mockImplementation(() => ({ delete: mockDelete })),
}));

import { DELETE } from '@/app/api/admin/generations/[id]/route';
import * as auth from '@/lib/auth-helper';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;
const mockedRequireBearer = auth.requireBearer as jest.Mock;
const req = (qs = '') => new NextRequest(`https://tamilagaval.com/api/admin/generations/gen_1${qs}`, { method: 'DELETE' });
const ctx = (id = 'gen_1') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-1' });
  mockedRequireBearer.mockReturnValue(undefined); // bearer present by default
  mockDelete.mockResolvedValue(undefined);
});

it('returns 403 for a non-admin and never deletes', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await DELETE(req('?briefId=b1'), ctx());
  expect(res.status).toBe(403);
  expect(mockDelete).not.toHaveBeenCalled();
});

it('returns 401 (CSRF guard) when no Bearer token is presented, never deleting', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireBearer.mockImplementationOnce(() => { throw new AuthError('Bearer token required for this operation', 401); });
  const res = await DELETE(req('?briefId=b1'), ctx());
  expect(res.status).toBe(401);
  expect(mockDelete).not.toHaveBeenCalled();
});

it('returns 400 when briefId is missing (cannot address the key)', async () => {
  const res = await DELETE(req(''), ctx());
  expect(res.status).toBe(400);
  expect(mockDelete).not.toHaveBeenCalled();
});

it('rejects a malformed generation id (no silent no-op delete)', async () => {
  const res = await DELETE(req('?briefId=b1'), ctx('not-a-gen-id'));
  expect(res.status).toBe(400);
  expect(mockDelete).not.toHaveBeenCalled();
});

it('deletes with the brief + generation id and returns 200', async () => {
  const res = await DELETE(req('?briefId=b1'), ctx('gen_1'));
  expect(res.status).toBe(200);
  expect((await res.json()).success).toBe(true);
  expect(mockDelete).toHaveBeenCalledWith('b1', 'gen_1');
});

it('returns 502 without leaking detail when the repo throws', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockDelete.mockRejectedValueOnce(new Error('ddb boom'));
  const res = await DELETE(req('?briefId=b1'), ctx());
  expect(res.status).toBe(502);
  expect((await res.json()).error).not.toMatch(/ddb boom/);
});
