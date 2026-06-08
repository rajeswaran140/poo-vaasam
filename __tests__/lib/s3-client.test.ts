/** @jest-environment node */
/**
 * S3 helper guards:
 * - normalizeContentType() canonicalises browser MIME quirks (audio/mp3 ->
 *   audio/mpeg) so stored objects always have a standard Content-Type.
 * - getPublicUrl() must route through the media CDN, never the (now-private) S3
 *   host, or the link would 403.
 */

describe('normalizeContentType', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { normalizeContentType } = require('@/infrastructure/storage/s3-client');

  it('maps the non-standard audio/mp3 to audio/mpeg', () => {
    expect(normalizeContentType('audio/mp3')).toBe('audio/mpeg');
  });

  it('is case-insensitive and trims', () => {
    expect(normalizeContentType('  AUDIO/MP3 ')).toBe('audio/mpeg');
  });

  it('maps other known aliases', () => {
    expect(normalizeContentType('audio/x-wav')).toBe('audio/wav');
    expect(normalizeContentType('audio/x-mpeg')).toBe('audio/mpeg');
  });

  it('passes through already-canonical / unknown types unchanged', () => {
    expect(normalizeContentType('audio/mpeg')).toBe('audio/mpeg');
    expect(normalizeContentType('audio/wav')).toBe('audio/wav');
    expect(normalizeContentType('image/png')).toBe('image/png');
  });
});

describe('S3Operations.getPublicUrl', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('returns a CDN URL (not the private S3 host) when MEDIA_BASE_URL is set', () => {
    process.env.MEDIA_BASE_URL = 'https://dxxxx.cloudfront.net';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3Operations } = require('@/infrastructure/storage/s3-client');
    const url = S3Operations.getPublicUrl('audio/poem-music/அந்தி மேகமே.mp3');
    expect(url.startsWith('https://dxxxx.cloudfront.net/')).toBe(true);
    expect(url).not.toContain('s3.us-east-1.amazonaws.com');
    expect(url).not.toContain(' ');
  });
});
