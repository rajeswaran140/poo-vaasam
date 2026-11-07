/** @jest-environment node */
/**
 * GET /api/admin/video-text/[id]/source — a 1-hour link to the stored source,
 * so the preview can play it again after a reload.
 */

const requireAdminMock = jest.fn();
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  requireBearer: jest.fn(),
  authErrorResponse: jest.fn((err: unknown) => new Response(String(err), { status: (err as { status?: number }).status ?? 401 })),
}));

const repo = { get: jest.fn() };
jest.mock('@/infrastructure/database/VideoTextRepository', () => ({
  VideoTextRepository: jest.fn().mockImplementation(() => repo),
}));

const presignGet = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { getSignedUrl: (...a: unknown[]) => presignGet(...a) },
}));

// The route module also holds the POST, which imports these at top level.
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  InvokeCommand: jest.fn(),
}));
jest.mock('@/lib/aws-config', () => ({ awsConfig: { region: 'ca-central-1', credentials: undefined } }));

import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/video-text/[id]/source/route';

const ID = 'p1';
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = () => new Request('http://localhost/x', { method: 'GET' }) as unknown as NextRequest;
const KEY = `audio/mastering/video-text/${ID}/source/a.mp4`;
const project = (source: Record<string, unknown> | null) => ({
  id: ID,
  source: source && { key: KEY, expiresAt: '2999-01-01T00:00:00.000Z', ...source },
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAdminMock.mockResolvedValue({ email: 'admin@test' });
  repo.get.mockResolvedValue(project({}));
  presignGet.mockResolvedValue('https://s3/get');
});

it('rejects a non-admin', async () => {
  requireAdminMock.mockRejectedValue({ status: 403 });
  expect((await GET(req(), ctx())).status).toBe(403);
  expect(presignGet).not.toHaveBeenCalled();
});

it('returns a 1-hour presigned GET for the stored source, played inline', async () => {
  const res = await GET(req(), ctx());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ url: 'https://s3/get' });
  // No download filename: the preview must play it, not save it.
  expect(presignGet).toHaveBeenCalledWith(KEY, 3600);
});

it('404s for a bad id, a missing project or no source', async () => {
  expect((await GET(req(), ctx('../x'))).status).toBe(404);
  repo.get.mockResolvedValueOnce(null);
  expect((await GET(req(), ctx())).status).toBe(404);
  repo.get.mockResolvedValueOnce(project(null));
  expect((await GET(req(), ctx())).status).toBe(404);
  expect(presignGet).not.toHaveBeenCalled();
});

it('refuses a key outside the project folder', async () => {
  repo.get.mockResolvedValue(project({ key: 'audio/mastering/video-text/other/source/a.mp4' }));
  expect((await GET(req(), ctx())).status).toBe(404);
  expect(presignGet).not.toHaveBeenCalled();
});

it('410s once the source has been deleted after 30 days', async () => {
  repo.get.mockResolvedValue(project({ expiresAt: '2000-01-01T00:00:00.000Z' }));
  const res = await GET(req(), ctx());
  expect(res.status).toBe(410);
  expect((await res.json()).error).toBe(
    'The uploaded video was deleted after 30 days — upload it again; your timing is kept.'
  );
  expect(presignGet).not.toHaveBeenCalled();
});

it('502s when presigning fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  presignGet.mockRejectedValue(new Error('boom'));
  expect((await GET(req(), ctx())).status).toBe(502);
});
