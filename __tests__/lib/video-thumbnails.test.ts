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

import { ensureThumbnailsMirrored, refreshThumbnails, _resetMirrorCache } from '@/lib/video-thumbnails';

const ID = 'abcdefghijk'; // valid 11-char id
const KEY = `images/video-thumbs/${ID}.jpg`;
const origFetch = global.fetch;

beforeEach(() => {
  fileExists.mockReset();
  uploadFile.mockReset();
  _resetMirrorCache(); // the in-process "already mirrored" set persists across calls
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

it('does not re-hit S3 for an id already confirmed present this process', async () => {
  fileExists.mockResolvedValue(true);
  await ensureThumbnailsMirrored([ID]); // first call confirms + caches
  await ensureThumbnailsMirrored([ID]); // second call should be a no-op
  await ensureThumbnailsMirrored([ID]);
  expect(fileExists).toHaveBeenCalledTimes(1); // only the first hit S3
});

describe('refreshThumbnails (force re-mirror)', () => {
  it('OVERWRITES the S3 mirror even when present, live + with a short Cache-Control', async () => {
    // Note: it never calls fileExists — a refresh always re-pulls.
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    global.fetch = fetchMock as unknown as typeof fetch;
    uploadFile.mockResolvedValue({});

    const out = await refreshThumbnails([ID]);
    expect(out).toEqual({ refreshed: [ID], failed: [] });
    expect(fileExists).not.toHaveBeenCalled();
    // Fetched LIVE (no-store) so we never re-mirror a cached image.
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
    const arg = uploadFile.mock.calls[0][0];
    expect(arg.key).toBe(KEY);
    expect(arg.contentType).toBe('image/jpeg');
    expect(arg.cacheControl).toMatch(/max-age=300/);
  });

  it('reports failures for invalid ids and missing thumbnails without throwing', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false }); // both sizes 404
    global.fetch = fetchMock as unknown as typeof fetch;
    const out = await refreshThumbnails(['bad', ID]);
    expect(out.failed).toContain('bad'); // invalid id — no network
    expect(out.failed).toContain(ID); // valid id but upstream 404
    expect(out.refreshed).toEqual([]);
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
