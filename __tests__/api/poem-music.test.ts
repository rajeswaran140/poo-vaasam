/** @jest-environment node */
/**
 * Tests for the poem background-music API (Lyria + S3 cache + fallback).
 *
 * Beyond the happy paths this covers the abuse guards, because this route is an
 * unauthenticated GET that can reach a billable Vertex AI call: the per-IP rate
 * limit, the `cnt_…` id format check, and — most importantly — that a caller
 * cannot mint arbitrary S3 cache keys and drive unbounded generation.
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
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn(),
}));

import { GET } from '@/app/api/poem-music/route';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { generateMusic } from '@/services/ai/lyria';
import { isLyriaEnabled } from '@/config/lyria';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';

const S3 = S3Operations as unknown as {
  fileExists: jest.Mock;
  getSignedUrl: jest.Mock;
  uploadFile: jest.Mock;
};
const Repo = ContentRepository as unknown as jest.Mock;

/** A syntactically valid content id, shaped like the real minted ones. */
const ID = 'cnt_1781049094952_wstyqacm4';

/**
 * Each request gets a distinct IP so the module-level rate limiter (state
 * persists across tests, exactly as it does on a warm Lambda) doesn't leak
 * budget between cases. The rate-limit tests opt into a fixed IP instead.
 */
let ipCounter = 0;
const req = (qs: string, ip?: string) =>
  new NextRequest(`http://localhost/api/poem-music${qs}`, {
    headers: { 'x-forwarded-for': ip ?? `10.0.0.${++ipCounter}` },
  });

/** Point the mocked repository at a given lookup result. */
const mockContent = (result: { isPublished: () => boolean } | null) => {
  Repo.mockImplementation(() => ({ findById: jest.fn().mockResolvedValue(result) }));
};
const publishedContent = { isPublished: () => true };
const draftContent = { isPublished: () => false };

describe('GET /api/poem-music', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContent(publishedContent);
  });

  describe('cache + generation behaviour', () => {
    it('returns the cached signed URL without generating', async () => {
      S3.fileExists.mockResolvedValue(true);
      S3.getSignedUrl.mockResolvedValue('https://signed/track.wav');

      const res = await GET(req(`?contentId=${ID}`));

      expect(await res.json()).toEqual({ url: 'https://signed/track.wav', cached: true });
      expect(generateMusic).not.toHaveBeenCalled();
    });

    it('serves a cached track without consulting DynamoDB, so a DB outage cannot break playback', async () => {
      S3.fileExists.mockResolvedValue(true);
      S3.getSignedUrl.mockResolvedValue('https://signed/track.wav');
      const findById = jest.fn();
      Repo.mockImplementation(() => ({ findById }));

      await GET(req(`?contentId=${ID}`));

      expect(findById).not.toHaveBeenCalled();
    });

    it('returns { url: null } on cache miss when Lyria is disabled', async () => {
      S3.fileExists.mockResolvedValue(false);
      (isLyriaEnabled as jest.Mock).mockReturnValue(false);

      const res = await GET(req(`?contentId=${ID}&emotion=sad`));

      expect(await res.json()).toEqual({ url: null });
      expect(generateMusic).not.toHaveBeenCalled();
    });

    it('generates, caches, and returns a URL on cache miss when Lyria is enabled', async () => {
      S3.fileExists.mockResolvedValue(false);
      (isLyriaEnabled as jest.Mock).mockReturnValue(true);
      (generateMusic as jest.Mock).mockResolvedValue(Buffer.from('WAVDATA'));
      S3.getSignedUrl.mockResolvedValue('https://signed/new.wav');

      const res = await GET(req(`?contentId=${ID}&emotion=sad&mood=somber`));

      expect(generateMusic).toHaveBeenCalledTimes(1);
      expect(S3.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          key: `audio/poem-music/${ID}.wav`,
          contentType: 'audio/wav',
        })
      );
      expect(await res.json()).toEqual({ url: 'https://signed/new.wav', cached: false });
    });

    it('falls back to { url: null } on any error', async () => {
      S3.fileExists.mockRejectedValue(new Error('s3 down'));

      const res = await GET(req(`?contentId=${ID}`));

      expect(await res.json()).toEqual({ url: null });
    });
  });

  describe('content-id validation (cache-key integrity)', () => {
    beforeEach(() => {
      S3.fileExists.mockResolvedValue(false);
      (isLyriaEnabled as jest.Mock).mockReturnValue(true);
    });

    it('returns { url: null } when contentId is missing', async () => {
      const res = await GET(req(''));

      expect(await res.json()).toEqual({ url: null });
      expect(S3.fileExists).not.toHaveBeenCalled();
    });

    it.each([
      ['arbitrary junk', 'aaa1'],
      ['a path traversal attempt', '../../etc/passwd'],
      ['a hyphenated id the old sanitiser would have accepted', 'cnt-123'],
      ['an id with a slash', 'cnt_1/2'],
      ['an id with a dot', 'cnt_1.wav'],
      ['a wrong prefix', 'poem_123'],
    ])('rejects %s without touching S3 or Lyria', async (_label, bad) => {
      const res = await GET(req(`?contentId=${encodeURIComponent(bad)}`));

      expect(await res.json()).toEqual({ url: null });
      expect(S3.fileExists).not.toHaveBeenCalled();
      expect(generateMusic).not.toHaveBeenCalled();
    });

    it('does NOT generate for a well-formed id that is not real content', async () => {
      mockContent(null);

      const res = await GET(req('?contentId=cnt_0000000000000_nosuchid'));

      expect(await res.json()).toEqual({ url: null });
      expect(generateMusic).not.toHaveBeenCalled();
      expect(S3.uploadFile).not.toHaveBeenCalled();
    });

    it('does NOT generate for content that exists but is unpublished', async () => {
      mockContent(draftContent);

      const res = await GET(req(`?contentId=${ID}`));

      expect(await res.json()).toEqual({ url: null });
      expect(generateMusic).not.toHaveBeenCalled();
    });

    it('cannot be walked to mint unbounded cache keys — the core spend guard', async () => {
      mockContent(null); // none of the probed ids are real content
      (generateMusic as jest.Mock).mockResolvedValue(Buffer.from('WAV'));

      for (let i = 0; i < 10; i++) {
        await GET(req(`?contentId=cnt_1700000000000_probe${i}`));
      }

      expect(generateMusic).not.toHaveBeenCalled();
      expect(S3.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('returns 429 once a single IP exceeds the window', async () => {
      S3.fileExists.mockResolvedValue(true);
      S3.getSignedUrl.mockResolvedValue('https://signed/track.wav');
      const ip = '198.51.100.7';

      const statuses: number[] = [];
      for (let i = 0; i < 25; i++) {
        const res = await GET(req(`?contentId=${ID}`, ip));
        statuses.push(res.status);
      }

      expect(statuses.filter((s) => s === 200)).toHaveLength(20);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    });

    it('sends Retry-After on the 429 so a well-behaved client can back off', async () => {
      S3.fileExists.mockResolvedValue(true);
      S3.getSignedUrl.mockResolvedValue('https://signed/track.wav');
      const ip = '198.51.100.8';

      let limited: Response | undefined;
      for (let i = 0; i < 25 && !limited; i++) {
        const res = await GET(req(`?contentId=${ID}`, ip));
        if (res.status === 429) limited = res;
      }

      expect(limited).toBeDefined();
      expect(Number(limited!.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(limited!.headers.get('X-RateLimit-Limit')).toBe('20');
    });
  });
});
