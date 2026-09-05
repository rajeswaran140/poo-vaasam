/** @jest-environment node */
/** GET/PUT/DELETE /api/admin/suno-prompts/[id] — gate, bad id, 404, update, delete. */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockFindById = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/infrastructure/database/SunoPromptRepository', () => ({
  SunoPromptRepository: jest.fn().mockImplementation(() => ({
    findById: mockFindById,
    update: mockUpdate,
    delete: mockDelete,
  })),
}));

import { GET, PUT, DELETE } from '@/app/api/admin/suno-prompts/[id]/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const BEARER = { Authorization: 'Bearer test-token' };
const ID = 'snp_1';

const getReq = (id = ID) => new NextRequest(`https://tamilagaval.com/api/admin/suno-prompts/${id}`);
const putReq = (b: unknown = {}, id = ID, withBearer = true) =>
  new NextRequest(`https://tamilagaval.com/api/admin/suno-prompts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(b),
    headers: withBearer ? BEARER : undefined,
  });
const delReq = (id = ID, withBearer = true) =>
  new NextRequest(`https://tamilagaval.com/api/admin/suno-prompts/${id}`, {
    method: 'DELETE',
    headers: withBearer ? BEARER : undefined,
  });
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true });
});

it('GET 403 for a non-admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await GET(getReq(), ctx())).status).toBe(403);
});

it('PUT/DELETE 401 without a Bearer token', async () => {
  expect((await PUT(putReq({ title: 'x' }, ID, false), ctx())).status).toBe(401);
  expect((await DELETE(delReq(ID, false), ctx())).status).toBe(401);
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockDelete).not.toHaveBeenCalled();
});

it('GET returns the prompt', async () => {
  mockFindById.mockResolvedValue({ id: ID, title: 'one' });
  const body = await (await GET(getReq(), ctx())).json();
  expect(body.prompt.id).toBe(ID);
});

it('GET 404 when it does not exist', async () => {
  mockFindById.mockResolvedValue(null);
  expect((await GET(getReq(), ctx())).status).toBe(404);
});

it('PUT 400 on an empty update', async () => {
  expect((await PUT(putReq({}), ctx())).status).toBe(400);
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('PUT 400 when setting audioInfluence while switching audio upload off', async () => {
  const res = await PUT(putReq({ usesAudioUpload: false, audioInfluence: 30 }), ctx());
  expect(res.status).toBe(400);
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('PUT updates and returns the prompt', async () => {
  mockUpdate.mockResolvedValue({ id: ID, title: 'renamed' });
  const body = await (await PUT(putReq({ title: 'renamed' }), ctx())).json();
  expect(body.prompt.title).toBe('renamed');
});

it('PUT 404 when the prompt is gone', async () => {
  mockUpdate.mockResolvedValue(null);
  expect((await PUT(putReq({ title: 'x' }), ctx())).status).toBe(404);
});

it('DELETE removes it', async () => {
  mockDelete.mockResolvedValue(true);
  expect((await DELETE(delReq(), ctx())).status).toBe(200);
  expect(mockDelete).toHaveBeenCalledWith(ID);
});

it('DELETE 404 when the prompt is gone', async () => {
  mockDelete.mockResolvedValue(false);
  expect((await DELETE(delReq(), ctx())).status).toBe(404);
});
