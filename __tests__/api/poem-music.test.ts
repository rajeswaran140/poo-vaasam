/** @jest-environment node */
/**
 * Tests for the poem background-music API (Lyria + S3 cache + fallback).
 */
import { NextRequest } from 'next/server';

jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: {
    fileExists: jest.fn(),
    getSignedUrl: jest.fn(),
    uploadFile: jest.fn(),
  },
}));
jest.mock('@/services/ai/lyria', () => ({ generateMusic: jest.fn() }));
jest.mock('@/config/lyria', () => ({ isLyriaEnabled: jest.fn() }));

import { GET } from '@/app/api/poem-music/route';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { generateMusic } from '@/services/ai/lyria';
import { isLyriaEnabled } from '@/config/lyria';

const S3 = S3Operations as unknown as {
  fileExists: jest.Mock;
  getSignedUrl: jest.Mock;
  uploadFile: jest.Mock;
};
const req = (qs: string) => new NextRequest(`http://localhost/api/poem-music${qs}`);

describe('GET /api/poem-music', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns { url: null } when contentId is missing', async () => {
    const res = await GET(req(''));
    expect(await res.json()).toEqual({ url: null });
  });

  it('returns the cached signed URL without generating', async () => {
    S3.fileExists.mockResolvedValue(true);
    S3.getSignedUrl.mockResolvedValue('https://signed/track.wav');
    const res = await GET(req('?contentId=p1'));
    expect(await res.json()).toEqual({ url: 'https://signed/track.wav', cached: true });
    expect(generateMusic).not.toHaveBeenCalled();
  });

  it('returns { url: null } on cache miss when Lyria is disabled', async () => {
    S3.fileExists.mockResolvedValue(false);
    (isLyriaEnabled as jest.Mock).mockReturnValue(false);
    const res = await GET(req('?contentId=p1&emotion=sad'));
    expect(await res.json()).toEqual({ url: null });
    expect(generateMusic).not.toHaveBeenCalled();
  });

  it('generates, caches, and returns a URL on cache miss when Lyria is enabled', async () => {
    S3.fileExists.mockResolvedValue(false);
    (isLyriaEnabled as jest.Mock).mockReturnValue(true);
    (generateMusic as jest.Mock).mockResolvedValue(Buffer.from('WAVDATA'));
    S3.getSignedUrl.mockResolvedValue('https://signed/new.wav');

    const res = await GET(req('?contentId=p1&emotion=sad&mood=somber'));

    expect(generateMusic).toHaveBeenCalledTimes(1);
    expect(S3.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'audio/poem-music/p1.wav', contentType: 'audio/wav' })
    );
    expect(await res.json()).toEqual({ url: 'https://signed/new.wav', cached: false });
  });

  it('falls back to { url: null } on any error', async () => {
    S3.fileExists.mockRejectedValue(new Error('s3 down'));
    const res = await GET(req('?contentId=p1'));
    expect(await res.json()).toEqual({ url: null });
  });
});
