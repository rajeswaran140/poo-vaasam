/** @jest-environment node */
/**
 * Tests for ensureThumbnailsMirrored — the self-healing S3 mirror that keeps
 * /videos off YouTube's CDN. Covers: skip-if-present, maxres→hq fallback,
 * invalid-id skipping, both-missing, and never-throws resilience.
 */

const fileExists = jest.fn();
const uploadFile = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    fileExists: (...a: unknown[]) => fileExists(...a),
    uploadFile: (...a: unknown[]) => uploadFile(...a),
  },
}));

import { ensureThumbnailsMirrored } from '@/lib/video-thumbnails';

const ID = 'abcdefghijk'; // valid 11-char id
const KEY = `images/video-thumbs/${ID}.jpg`;
const origFetch = global.fetch;

beforeEach(() => {
  fileExists.mockReset();
  uploadFile.mockReset();
});
afterEach(() => {
  global.fetch = origFetch;
});

it('skips videos already mirrored (no fetch, no upload)', async () => {
  fileExists.mockResolvedValue(true);
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  await ensureThumbnailsMirrored([ID]);
  expect(fileExists).toHaveBeenCalledWith(KEY);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(uploadFile).not.toHaveBeenCalled();
});

it('mirrors a missing thumbnail from maxresdefault → S3 (jpeg buffer)', async () => {
  fileExists.mockResolvedValue(false);
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) as unknown as typeof fetch;
  uploadFile.mockResolvedValue({});
  await ensureThumbnailsMirrored([ID]);
  expect(global.fetch).toHaveBeenCalledWith(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
  expect(uploadFile).toHaveBeenCalledTimes(1);
  const arg = uploadFile.mock.calls[0][0];
  expect(arg.key).toBe(KEY);
  expect(arg.contentType).toBe('image/jpeg');
  expect(Buffer.isBuffer(arg.file)).toBe(true);
});

it('falls back to hqdefault when maxres is missing', async () => {
  fileExists.mockResolvedValue(false);
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ ok: false }) // maxres 404
    .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([9]).buffer }); // hq ok
  global.fetch = fetchMock as unknown as typeof fetch;
  uploadFile.mockResolvedValue({});
  await ensureThumbnailsMirrored([ID]);
  expect(fetchMock.mock.calls[1][0]).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  expect(uploadFile).toHaveBeenCalledTimes(1);
});

it('does not upload when both thumbnail sizes are missing', async () => {
  fileExists.mockResolvedValue(false);
  global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
  await ensureThumbnailsMirrored([ID]);
  expect(uploadFile).not.toHaveBeenCalled();
});

it('skips invalid video ids without any S3/network calls', async () => {
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  await ensureThumbnailsMirrored(['short', '', 'bad id!!!!!', 'toolongtobevalid']);
  expect(fileExists).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('never throws when S3 errors (resilient)', async () => {
  fileExists.mockRejectedValue(new Error('s3 unavailable'));
  global.fetch = jest.fn() as unknown as typeof fetch;
  await expect(ensureThumbnailsMirrored([ID])).resolves.toBeUndefined();
  expect(uploadFile).not.toHaveBeenCalled();
});
