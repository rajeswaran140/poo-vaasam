/** @jest-environment node */
/**
 * Tests for the admin presigned-upload API (/api/admin/upload).
 */

import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/auth-helper';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    generateFileKey: jest.fn(() => 'audio/123_song.mp3'),
    getSignedUploadUrl: jest.fn(async () => 'https://signed.example/put?sig=abc'),
    getPublicUrl: jest.fn(
      () => 'https://tamil-web-media.s3.us-east-1.amazonaws.com/audio/123_song.mp3'
    ),
  },
  FILE_CONSTRAINTS: {
    maxSize: { image: 10 * 1024 * 1024, audio: 50 * 1024 * 1024, video: 50 * 1024 * 1024 },
    allowedTypes: {
      image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'],
      video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'],
    },
  },
}));

import { POST } from '@/app/api/admin/upload/route';
import * as authHelper from '@/lib/auth-helper';
import { S3Operations } from '@/infrastructure/storage/s3-client';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    new Request('http://localhost:3000/api/admin/upload', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (authHelper.requireAdmin as jest.Mock).mockResolvedValue({
    isAuthenticated: true,
    userId: 'admin-1',
    email: 'admin@tamilagaval.com',
    groups: ['admin'],
  });
});

describe('POST /api/admin/upload — auth', () => {
  it('returns 403 for an authenticated non-admin', async () => {
    (authHelper.requireAdmin as jest.Mock).mockRejectedValue(new AuthError('Forbidden', 403));
    const res = await POST(makeRequest({ filename: 'a.mp3', contentType: 'audio/mpeg', kind: 'audio' }));
    expect(res.status).toBe(403);
    expect(S3Operations.getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    (authHelper.requireAdmin as jest.Mock).mockRejectedValue(new AuthError('Unauthorized', 401));
    const res = await POST(makeRequest({ filename: 'a.mp3', contentType: 'audio/mpeg', kind: 'audio' }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/upload — presigning', () => {
  it('returns a presigned URL, public URL and public-tag headers for valid audio', async () => {
    const res = await POST(
      makeRequest({ filename: 'song.mp3', contentType: 'audio/mpeg', kind: 'audio', size: 1024 })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.uploadUrl).toBe('https://signed.example/put?sig=abc');
    expect(json.data.publicUrl).toContain('tamil-web-media');
    expect(json.data.headers['x-amz-tagging']).toBe('public=true');
    expect(json.data.headers['Content-Type']).toBe('audio/mpeg');

    // The presigned PUT must be signed WITH the public tag.
    expect(S3Operations.getSignedUploadUrl).toHaveBeenCalledWith(
      expect.any(String),
      'audio/mpeg',
      expect.any(Number),
      { tagging: 'public=true' }
    );
  });

  it('accepts short video previews', async () => {
    const res = await POST(
      makeRequest({ filename: 'teaser.mp4', contentType: 'video/mp4', kind: 'video', size: 2048 })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('rejects an unsupported content type for the kind', async () => {
    const res = await POST(
      makeRequest({ filename: 'x.pdf', contentType: 'application/pdf', kind: 'audio' })
    );
    expect(res.status).toBe(400);
    expect(S3Operations.getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects files over the size cap', async () => {
    const res = await POST(
      makeRequest({
        filename: 'huge.mp4',
        contentType: 'video/mp4',
        kind: 'video',
        size: 200 * 1024 * 1024,
      })
    );
    expect(res.status).toBe(400);
    expect(S3Operations.getSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    const res = await POST(makeRequest({ contentType: 'audio/mpeg', kind: 'audio' })); // missing filename
    expect(res.status).toBe(400);
  });
});
