/** @jest-environment node */
const findByToken = jest.fn();
const consume = jest.fn();
const getSignedUrl = jest.fn(async () => 'https://s3.invalid/signed');
const checkRateLimit = jest.fn();
const rateLimitedResponse = jest.fn();

jest.mock('@/infrastructure/database/DeliveryRepository', () => ({
  DeliveryRepository: jest.fn().mockImplementation(() => ({ findByToken, consume })),
}));
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { getSignedUrl: (...a: unknown[]) => getSignedUrl(...a) },
}));
jest.mock('@/lib/rate-limit', () => {
  const rateLimiterInstances: any[] = [];
  return {
    SharedRateLimiter: jest.fn(function(config: any) {
      const instance = { reset: jest.fn(), config };
      rateLimiterInstances.push(instance);
      return instance;
    }),
    checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
    rateLimitedResponse: (...a: unknown[]) => rateLimitedResponse(...a),
    clientIp: (r: any) => '1.2.3.4',
    __resetAllLimiters: () => {
      rateLimiterInstances.forEach(instance => instance.reset());
    },
  };
});

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

beforeEach(() => {
  jest.clearAllMocks();
  // Access the __resetAllLimiters from the mocked module
  const { __resetAllLimiters } = require('@/lib/rate-limit');
  __resetAllLimiters();
  checkRateLimit.mockResolvedValue({ allowed: true });
  rateLimitedResponse.mockReturnValue(new Response('rate limited', { status: 429 }));
});

it('redirects a valid token to a short-lived presigned URL', async () => {
  findByToken.mockResolvedValueOnce(live());
  consume.mockResolvedValueOnce({ ok: true, delivery: live({ downloadCount: 1 }) });

  const res = await GET(req(), ctx());
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('https://s3.invalid/signed');
  // 60s, and the buyer's filename rather than the S3 key.
  expect(getSignedUrl).toHaveBeenCalledWith('deliveries/a.mp3', 60, 'Song.mp3');
});

it('proves the route uses the s3Key, not the buyer-facing filename, and never leaks it', async () => {
  // Make the signed URL contain the key so a buggy route would leak it
  getSignedUrl.mockResolvedValueOnce('https://s3.example/deliveries/a.mp3?token=xyz');
  findByToken.mockResolvedValueOnce(live());
  consume.mockResolvedValueOnce({ ok: true, delivery: live({ downloadCount: 1 }) });

  const res = await GET(req(), ctx());
  // Proves the route called getSignedUrl with the actual key, not the filename
  expect(getSignedUrl).toHaveBeenCalledWith('deliveries/a.mp3', 60, 'Song.mp3');
  // The Location header (where the browser is redirected) should be the signed URL, not the key
  expect(res.headers.get('location')).toBe('https://s3.example/deliveries/a.mp3?token=xyz');
  // The response body should be empty (302 has no body), proving we never leaked it there
  expect(await res.text()).toBe('');
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

it('enforces rate limit before any database work', async () => {
  checkRateLimit.mockResolvedValueOnce({ allowed: false });
  rateLimitedResponse.mockReturnValueOnce(new Response('rate limited', { status: 429 }));

  const res = await GET(req(), ctx());
  expect(res.status).toBe(429);
  expect(findByToken).not.toHaveBeenCalled();
});
