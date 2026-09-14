/** @jest-environment node */
const findByToken = jest.fn();
const consume = jest.fn();
const getSignedUrl = jest.fn(async () => 'https://s3.invalid/signed');

jest.mock('@/infrastructure/database/DeliveryRepository', () => ({
  DeliveryRepository: jest.fn().mockImplementation(() => ({ findByToken, consume })),
}));
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { getSignedUrl: (...a: unknown[]) => getSignedUrl(...a) },
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/d/[token]/route';

const TOKEN = 'a'.repeat(43);
const ctx = (t = TOKEN) => ({ params: Promise.resolve({ token: t }) });
const req = () => new NextRequest('https://tamilagaval.com/api/d/x');

const live = (over = {}) => ({
  token: TOKEN, s3Key: 'deliveries/a.mp3', filename: 'Song.mp3', label: 'B',
  contentLength: 10, createdAt: '2026-09-14T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
  maxDownloads: 3, downloadCount: 0, downloads: [], revokedAt: null, ...over,
});

beforeEach(() => jest.clearAllMocks());

it('redirects a valid token to a short-lived presigned URL', async () => {
  findByToken.mockResolvedValueOnce(live());
  consume.mockResolvedValueOnce({ ok: true, delivery: live({ downloadCount: 1 }) });

  const res = await GET(req(), ctx());
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('https://s3.invalid/signed');
  // 60s, and the buyer's filename rather than the S3 key.
  expect(getSignedUrl).toHaveBeenCalledWith('deliveries/a.mp3', 60, 'Song.mp3');
});

it('never puts the s3Key in a response the buyer can read', async () => {
  findByToken.mockResolvedValueOnce(live());
  consume.mockResolvedValueOnce({ ok: true, delivery: live({ downloadCount: 1 }) });
  const res = await GET(req(), ctx());
  expect(await res.text()).not.toContain('deliveries/a.mp3');
});

it('rejects a malformed token without touching the database', async () => {
  const res = await GET(req(), ctx('../../etc/passwd'));
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toContain('e=invalid');
  expect(findByToken).not.toHaveBeenCalled();
});

it('sends an unknown token back to the page, not to a 500', async () => {
  findByToken.mockResolvedValueOnce(null);
  const res = await GET(req(), ctx());
  expect(res.headers.get('location')).toContain('e=invalid');
});

it('refuses an expired link before consuming a download', async () => {
  findByToken.mockResolvedValueOnce(live({ expiresAt: '2020-01-01T00:00:00.000Z' }));
  const res = await GET(req(), ctx());
  expect(res.headers.get('location')).toContain('e=expired');
  expect(consume).not.toHaveBeenCalled();
});

it('refuses a revoked link before consuming a download', async () => {
  findByToken.mockResolvedValueOnce(live({ revokedAt: '2026-09-14T01:00:00.000Z' }));
  const res = await GET(req(), ctx());
  expect(res.headers.get('location')).toContain('e=revoked');
  expect(consume).not.toHaveBeenCalled();
});

it('honours the race lost at the database, not the read before it', async () => {
  // The row looked usable, but a simultaneous click took the last download.
  findByToken.mockResolvedValueOnce(live({ downloadCount: 2 }));
  consume.mockResolvedValueOnce({ ok: false, reason: 'exhausted' });
  const res = await GET(req(), ctx());
  expect(res.headers.get('location')).toContain('e=exhausted');
  expect(getSignedUrl).not.toHaveBeenCalled();
});
