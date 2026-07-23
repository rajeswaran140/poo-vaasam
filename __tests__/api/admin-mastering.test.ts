/** @jest-environment node */
/**
 * /api/admin/mastering routes — presigned upload (WAV-only, size-capped) and
 * presigned download (prefix-bounded). Admin-gated; S3 mocked, so no network.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
  requireBearer: jest.fn(),
}));

const mockUploadPost = jest.fn();
const mockSignedGet = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    getSignedUploadPost: (...a: unknown[]) => mockUploadPost(...a),
    getSignedUrl: (...a: unknown[]) => mockSignedGet(...a),
  },
}));

import { POST as uploadPOST } from '@/app/api/admin/mastering/upload/route';
import { GET as downloadGET } from '@/app/api/admin/mastering/download/route';
import { MASTERING_PREFIX, MAX_UPLOAD_BYTES } from '@/lib/mastering-storage';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const requireBearer = auth.requireBearer as jest.Mock;

const post = (body: unknown) =>
  new NextRequest('https://tamilagaval.com/api/admin/mastering/upload', {
    method: 'POST',
    body: JSON.stringify(body),
  });
const get = (qs: string) =>
  new NextRequest(`https://tamilagaval.com/api/admin/mastering/download${qs}`);

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-1' });
  requireBearer.mockReturnValue(undefined);
  mockUploadPost.mockResolvedValue({ url: 'https://s3.example/upload', fields: { key: 'k' } });
  mockSignedGet.mockResolvedValue('https://s3.example/signed-get');
});

describe('upload presign', () => {
  it('403s for a non-admin', async () => {
    requireAdmin.mockRejectedValueOnce(Object.assign(new Error('no'), { statusCode: 403 }));
    const res = await uploadPOST(post({ filename: 'a.wav', contentType: 'audio/wav' }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockUploadPost).not.toHaveBeenCalled();
  });

  it('presigns a WAV into the mastering prefix', async () => {
    const res = await uploadPOST(post({ filename: 'My Song.wav', contentType: 'audio/wav', size: 50_000_000 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.key.startsWith(MASTERING_PREFIX)).toBe(true);
    expect(body.uploadUrl).toBe('https://s3.example/upload');

    // S3 must enforce the cap and pin the type — not just the browser.
    const [, contentType, maxSize] = mockUploadPost.mock.calls[0];
    expect(contentType).toBe('audio/wav');
    expect(maxSize).toBe(MAX_UPLOAD_BYTES);
    // The CSRF defence is load-bearing; without this assertion deleting the
    // requireBearer call would leave the suite green.
    expect(requireBearer).toHaveBeenCalled();
  });

  it('refuses a lossy source', async () => {
    for (const contentType of ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'video/mp4']) {
      const res = await uploadPOST(post({ filename: 'a.mp3', contentType }));
      expect(res.status).toBe(400);
    }
    expect(mockUploadPost).not.toHaveBeenCalled();
  });

  it('refuses an oversized file before presigning', async () => {
    const res = await uploadPOST(post({ filename: 'a.wav', contentType: 'audio/wav', size: MAX_UPLOAD_BYTES + 1 }));
    expect(res.status).toBe(400);
    expect(mockUploadPost).not.toHaveBeenCalled();
  });

  it('400s on a malformed body', async () => {
    expect((await uploadPOST(post({ contentType: 'audio/wav' }))).status).toBe(400);
  });
});

describe('download presign', () => {
  it('403s for a non-admin', async () => {
    requireAdmin.mockRejectedValueOnce(Object.assign(new Error('no'), { statusCode: 403 }));
    const res = await downloadGET(get(`?key=${encodeURIComponent(`${MASTERING_PREFIX}x-master-14LUFS.wav`)}`));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockSignedGet).not.toHaveBeenCalled();
  });

  it('signs a key inside the workspace', async () => {
    const key = `${MASTERING_PREFIX}1_a_song-master-14LUFS.wav`;
    const res = await downloadGET(get(`?key=${encodeURIComponent(key)}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, url: 'https://s3.example/signed-get' });
    // Third arg forces Content-Disposition: attachment. Without it the browser
    // honours the object's audio/wav type and plays the master instead of
    // saving it.
    expect(mockSignedGet).toHaveBeenCalledWith(key, expect.any(Number), '1_a_song-master-14LUFS.wav');
    expect(body.filename).toBe('1_a_song-master-14LUFS.wav');
  });

  it('refuses to sign anything outside the workspace', async () => {
    // The whole point of the prefix check: an admin session must not be able to
    // mint a presigned URL for arbitrary bucket objects.
    for (const key of ['audio/poem-music/song.mp3', 'images/x.png', `${MASTERING_PREFIX}../poem-music/song.mp3`, '']) {
      const res = await downloadGET(get(`?key=${encodeURIComponent(key)}`));
      expect(res.status).toBe(400);
    }
    expect(mockSignedGet).not.toHaveBeenCalled();
  });
});
