/** @jest-environment node */
const create = jest.fn(async (i: Record<string, unknown>) => ({ token: 'c'.repeat(43), ...i }));
const list = jest.fn(async () => []);
const revoke = jest.fn(async () => undefined);
const getContentLength = jest.fn(async () => 12151796);

jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { getContentLength: (...a: unknown[]) => getContentLength(...a) },
}));
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn(async () => ({ isAuthenticated: true, userId: 'u1' })),
  requireBearer: jest.fn(() => undefined),
  authErrorResponse: () => new Response('{}', { status: 401 }),
}));
jest.mock('@/infrastructure/database/DeliveryRepository', () => ({
  DeliveryRepository: jest.fn().mockImplementation(() => ({ create, list, revoke })),
}));

import { NextRequest } from 'next/server';
import { requireAdmin, requireBearer } from '@/lib/auth-helper';
import { POST, GET } from '@/app/api/admin/deliveries/route';
import { POST as REVOKE } from '@/app/api/admin/deliveries/[token]/revoke/route';

const post = (body: unknown) =>
  new NextRequest('https://x.test/api/admin/deliveries', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });

beforeEach(() => jest.clearAllMocks());

it('requires admin to list', async () => {
  await GET(new NextRequest('https://x.test/api/admin/deliveries'));
  expect(requireAdmin).toHaveBeenCalled();
});

it('requires a bearer token to create — a cookie alone is CSRF-able', async () => {
  await POST(post({ s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'B' }));
  expect(requireBearer).toHaveBeenCalled();
});

it('creates and returns the full link, not just the token', async () => {
  const res = await POST(post({ s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'B' }));
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.url).toBe(`https://tamilagaval.com/d/${'c'.repeat(43)}`);
});

it('refuses a key outside the deliveries prefix', async () => {
  const res = await POST(post({ s3Key: 'audio/poem-music/song.mp3', filename: 'a.mp3', label: 'B' }));
  expect(res.status).toBe(400);
  expect(create).not.toHaveBeenCalled();
});

it('refuses to mint a link for an object that is not there', async () => {
  // Otherwise the failure surfaces at download time, in front of the buyer.
  getContentLength.mockResolvedValueOnce(null);
  const res = await POST(post({ s3Key: 'deliveries/ghost.mp3', filename: 'a.mp3', label: 'B' }));
  expect(res.status).toBe(404);
  expect(create).not.toHaveBeenCalled();
});

it('records the real byte size, so the page does not say 0.0 MB', async () => {
  getContentLength.mockResolvedValueOnce(12151796);
  await POST(post({ s3Key: 'deliveries/a.mp3', filename: 'a.mp3', label: 'B' }));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ contentLength: 12151796 }));
});

it('revokes only a well-formed token', async () => {
  const bad = await REVOKE(post({}), { params: Promise.resolve({ token: '../x' }) });
  expect(bad.status).toBe(400);
  expect(revoke).not.toHaveBeenCalled();

  const ok = await REVOKE(post({}), { params: Promise.resolve({ token: 'd'.repeat(43) }) });
  expect(ok.status).toBe(200);
  expect(revoke).toHaveBeenCalledWith('d'.repeat(43));
});
