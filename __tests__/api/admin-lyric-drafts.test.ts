/** @jest-environment node */
/**
 * Tests for the /api/admin/lyric-drafts routes (list/create, get/patch/delete,
 * add-version). Admin-gated; the repository is mocked — these cover auth, body
 * validation, id validation, and not-found mapping.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const repo = {
  list: jest.fn(), create: jest.fn(), get: jest.fn(),
  addVersion: jest.fn(), updateMeta: jest.fn(), delete: jest.fn(),
};
jest.mock('@/infrastructure/database/LyricDraftRepository', () => ({
  LyricDraftRepository: jest.fn().mockImplementation(() => repo),
}));

import { GET as listGET, POST as createPOST } from '@/app/api/admin/lyric-drafts/route';
import { GET as oneGET, PATCH, DELETE } from '@/app/api/admin/lyric-drafts/[id]/route';
import { POST as versionPOST } from '@/app/api/admin/lyric-drafts/[id]/versions/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const url = 'https://tamilagaval.com/api/admin/lyric-drafts';
const get = () => new NextRequest(url);
const BEARER = { Authorization: 'Bearer test-token' };
const post = (body: unknown, u = url, withBearer = true) =>
  new NextRequest(u, { method: 'POST', body: JSON.stringify(body), headers: withBearer ? BEARER : undefined });
const patch = (body: unknown) => new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body), headers: BEARER });
const del = () => new NextRequest(url, { method: 'DELETE', headers: BEARER });
const P = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-1' });
});

it('GET list returns the drafts', async () => {
  repo.list.mockResolvedValue([{ id: 'draft_1', title: 'A' }]);
  const res = await listGET(get());
  expect(res.status).toBe(200);
  expect((await res.json()).drafts).toHaveLength(1);
});

it('GET list 403s for a non-admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  expect((await listGET(get())).status).toBe(403);
  expect(repo.list).not.toHaveBeenCalled();
});

it('POST create validates the body (title required)', async () => {
  const res = await createPOST(post({ lyrics: 'வரிகள்' })); // no title
  expect(res.status).toBe(400);
  expect(repo.create).not.toHaveBeenCalled();
});

it('POST create returns 401 without a Bearer token (CSRF defense)', async () => {
  const res = await createPOST(post({ title: 'மண்வாசம்', lyrics: 'பல்லவி' }, url, false));
  expect(res.status).toBe(401);
  expect(repo.create).not.toHaveBeenCalled();
});

it('POST create returns 201 with the new draft', async () => {
  repo.create.mockResolvedValue({ id: 'draft_1', title: 'மண்வாசம்', latestVersion: 1 });
  const res = await createPOST(post({ title: 'மண்வாசம்', lyrics: 'பல்லவி' }));
  expect(res.status).toBe(201);
  expect((await res.json()).draft.id).toBe('draft_1');
});

it('GET one rejects a malformed id', async () => {
  const res = await oneGET(get(), P('not-a-draft-id'));
  expect(res.status).toBe(400);
});

it('GET one maps a missing draft to 404', async () => {
  repo.get.mockResolvedValue(null);
  const res = await oneGET(get(), P('draft_x'));
  expect(res.status).toBe(404);
});

it('POST version 404s when the draft is unknown', async () => {
  repo.addVersion.mockRejectedValue(new Error('Lyric draft draft_x not found'));
  const res = await versionPOST(post({ lyrics: 'v2' }, `${url}/draft_x/versions`), P('draft_x'));
  expect(res.status).toBe(404);
});

it('POST version returns 201 with the updated draft', async () => {
  repo.addVersion.mockResolvedValue({ id: 'draft_x', latestVersion: 2 });
  const res = await versionPOST(post({ lyrics: 'v2 text' }, `${url}/draft_x/versions`), P('draft_x'));
  expect(res.status).toBe(201);
  expect((await res.json()).draft.latestVersion).toBe(2);
});

it('PATCH updates metadata', async () => {
  repo.updateMeta.mockResolvedValue({ id: 'draft_x', status: 'ready' });
  const res = await PATCH(patch({ status: 'ready' }), P('draft_x'));
  expect(res.status).toBe(200);
  expect(repo.updateMeta).toHaveBeenCalledWith('draft_x', { status: 'ready' });
});

it('PATCH rejects an empty update', async () => {
  const res = await PATCH(patch({}), P('draft_x'));
  expect(res.status).toBe(400);
});

it('DELETE removes the draft', async () => {
  repo.delete.mockResolvedValue(undefined);
  const res = await DELETE(del(), P('draft_x'));
  expect(res.status).toBe(200);
  expect(repo.delete).toHaveBeenCalledWith('draft_x');
});
