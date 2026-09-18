/** @jest-environment node */
const create = jest.fn(async (i: Record<string, unknown>) => ({ token: 'c'.repeat(43), ...i }));
const list = jest.fn(async () => []);
// revoke() now answers whether it matched a row — a revoke that hit nothing is
// a typo, and used to succeed silently while creating an invisible junk row.
const revoke = jest.fn(async () => true);
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

const get = () => new NextRequest('https://x.test/api/admin/deliveries');
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

/**
 * `s3Key` is where the file lives. The type has always said it is never sent to
 * a client; until now both responses carried it. Admin-only and not a leak that
 * mattered — but the guarantee has to be real, because the next reader builds
 * on it.
 */
it('never sends s3Key to the browser, on create or on list', async () => {
  create.mockResolvedValueOnce({
    token: 'a'.repeat(43), s3Key: 'deliveries/anton/secret-path.mp3', filename: 'x.mp3',
    label: 'l', contentLength: 1, createdAt: 'c', expiresAt: 'e',
    maxDownloads: 5, downloadCount: 0, downloads: [], revokedAt: null,
  });
  const made = await POST(post({ s3Key: 'deliveries/a.mp3', filename: 'x.mp3', label: 'l' }));
  expect(JSON.stringify(await made.json())).not.toContain('secret-path');

  list.mockResolvedValueOnce([{
    token: 'b'.repeat(43), s3Key: 'deliveries/anton/other-secret.mp3', filename: 'y.mp3',
    label: 'l', contentLength: 1, createdAt: 'c', expiresAt: 'e',
    maxDownloads: 5, downloadCount: 0, downloads: [], revokedAt: null,
  }]);
  const listed = await GET(get());
  expect(JSON.stringify(await listed.json())).not.toContain('other-secret');
});

/**
 * The link used to be shown once, in a box after creation. Close the tab before
 * emailing it and the only way back was minting a second link.
 */
it('gives every listed delivery its full URL, so it can be copied again', async () => {
  list.mockResolvedValueOnce([{
    token: 'c'.repeat(43), s3Key: 'deliveries/a.mp3', filename: 'y.mp3', label: 'l',
    contentLength: 1, createdAt: 'c', expiresAt: 'e',
    maxDownloads: 5, downloadCount: 0, downloads: [], revokedAt: null,
  }]);
  const body = await (await GET(get())).json();
  expect(body.deliveries[0].url).toMatch(new RegExp(`/d/${'c'.repeat(43)}$`));
});

/** A revoke that matched nothing is a typo, and used to succeed silently. */
it('404s a revoke that matched no delivery', async () => {
  revoke.mockResolvedValueOnce(false);
  const res = await REVOKE(post({}), { params: Promise.resolve({ token: 'e'.repeat(43) }) });
  expect(res.status).toBe(404);
  expect((await res.json()).error).toMatch(/No delivery/i);
});
