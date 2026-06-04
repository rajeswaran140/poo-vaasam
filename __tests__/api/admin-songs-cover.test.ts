/** @jest-environment node */
/**
 * Tests for POST /api/admin/songs/[id]/cover — admin gate, 404, the
 * generate→upload→setFeaturedImage happy path, and error mapping.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockFindById = jest.fn();
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({ findById: mockFindById })),
}));

const mockGen = jest.fn();
jest.mock('@/services/ai/cover-art', () => ({
  generateCoverArt: (...a: unknown[]) => mockGen(...a),
  defaultCoverPrompt: () => 'default-prompt',
}));

const mockUpload = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { uploadFile: (...a: unknown[]) => mockUpload(...a) },
}));

const mockUpdate = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { update: (...a: unknown[]) => mockUpdate(...a) },
}));

import { POST } from '@/app/api/admin/songs/[id]/cover/route';
import * as auth from '@/lib/auth-helper';

const mockedRequireAdmin = auth.requireAdmin as jest.Mock;

const req = (b: unknown = {}) =>
  new NextRequest('https://tamilagaval.com/api/admin/songs/cnt_1/cover', { method: 'POST', body: JSON.stringify(b) });
const ctx = (id = 'cnt_1') => ({ params: Promise.resolve({ id }) });
const songEntity = (o: Record<string, unknown> = { id: 'cnt_1', title: 'அம்மா' }) => ({ toObject: () => o });

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequireAdmin.mockResolvedValue({ isAuthenticated: true });
});

it('returns 403 when not admin (no generation)', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockedRequireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
  const res = await POST(req(), ctx());
  expect(res.status).toBe(403);
  expect(mockGen).not.toHaveBeenCalled();
});

it('returns 404 when the song does not exist', async () => {
  mockFindById.mockResolvedValueOnce(null);
  const res = await POST(req(), ctx());
  expect(res.status).toBe(404);
  expect(mockGen).not.toHaveBeenCalled();
});

it('generates, uploads a PNG buffer, sets featuredImage, returns 200', async () => {
  mockFindById.mockResolvedValueOnce(songEntity());
  mockGen.mockResolvedValueOnce({ ok: true, base64: 'QUJD' });
  mockUpload.mockResolvedValueOnce({ url: 'https://tamil-web-media.s3.us-east-1.amazonaws.com/images/song-covers/cnt_1-9.png' });
  mockUpdate.mockResolvedValueOnce({});

  const res = await POST(req(), ctx());
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.data.featuredImage).toContain('song-covers');
  expect(Buffer.isBuffer(mockUpload.mock.calls[0][0].file)).toBe(true);
  expect(mockUpload.mock.calls[0][0].contentType).toBe('image/png');
  expect(mockUpdate).toHaveBeenCalledTimes(1);
});

it('maps a generation failure to 502 and does not upload', async () => {
  mockFindById.mockResolvedValueOnce(songEntity());
  mockGen.mockResolvedValueOnce({ ok: false, error: 'Image generation failed. Please try again.' });
  const res = await POST(req(), ctx());
  expect(res.status).toBe(502);
  expect(mockUpload).not.toHaveBeenCalled();
});

it('maps a not-configured failure to 503', async () => {
  mockFindById.mockResolvedValueOnce(songEntity());
  mockGen.mockResolvedValueOnce({ ok: false, error: 'AI image generation is not configured (OPENAI_API_KEY missing).' });
  const res = await POST(req(), ctx());
  expect(res.status).toBe(503);
});
