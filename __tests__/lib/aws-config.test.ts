/** @jest-environment node */
/**
 * Guards that AWS credentials never leak into the client-facing config objects
 * (`cognitoConfig`, `amplifyConfig`), which can be imported by client components.
 */

describe('aws-config credential isolation', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('keeps AWS credentials out of cognitoConfig and amplifyConfig even when set', () => {
    process.env.NEXT_PUBLIC_APP_AWS_ACCESS_KEY_ID = 'AKIATESTLEAK000000';
    process.env.NEXT_PUBLIC_APP_AWS_SECRET_ACCESS_KEY = 'secretLEAKvalue123';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('@/lib/aws-config');

    for (const obj of [cfg.cognitoConfig, cfg.amplifyConfig]) {
      const serialized = JSON.stringify(obj);
      expect(serialized).not.toContain('AKIATESTLEAK000000');
      expect(serialized).not.toContain('secretLEAKvalue123');
    }
  });

  it('does still expose credentials on the server-only config (sanity check)', () => {
    process.env.APP_AWS_ACCESS_KEY_ID = 'AKIASERVERONLY00000';
    process.env.APP_AWS_SECRET_ACCESS_KEY = 'serverSecret456';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('@/lib/aws-config');
    expect(cfg.s3Config.credentials?.accessKeyId).toBe('AKIASERVERONLY00000');
  });
});

describe('mediaUrl / mediaConfig', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('routes keys through MEDIA_BASE_URL (the CDN) when set', () => {
    process.env.MEDIA_BASE_URL = 'https://dxxxx.cloudfront.net';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mediaUrl, mediaConfig } = require('@/lib/aws-config');
    expect(mediaConfig.baseUrl).toBe('https://dxxxx.cloudfront.net');
    expect(mediaUrl('audio/song.mp3')).toBe('https://dxxxx.cloudfront.net/audio/song.mp3');
  });

  it('strips a trailing slash on the base and a leading slash on the key', () => {
    process.env.MEDIA_BASE_URL = 'https://dxxxx.cloudfront.net/';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mediaUrl } = require('@/lib/aws-config');
    expect(mediaUrl('/images/cover.png')).toBe('https://dxxxx.cloudfront.net/images/cover.png');
  });

  it('percent-encodes Tamil + space path segments but keeps the slashes', () => {
    process.env.MEDIA_BASE_URL = 'https://dxxxx.cloudfront.net';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mediaUrl } = require('@/lib/aws-config');
    const url = mediaUrl('audio/poem-music/அந்தி மேகமே.mp3');
    expect(url).toBe(
      'https://dxxxx.cloudfront.net/audio/poem-music/' +
        encodeURIComponent('அந்தி மேகமே.mp3')
    );
    expect(url).not.toContain(' '); // space must be encoded
    expect(url.split('/').length).toBe(6); // slashes preserved
  });

  it('falls back to the direct S3 URL when MEDIA_BASE_URL is unset', () => {
    delete process.env.MEDIA_BASE_URL;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mediaUrl } = require('@/lib/aws-config');
    expect(mediaUrl('audio/song.mp3')).toBe(
      'https://tamil-web-media.s3.us-east-1.amazonaws.com/audio/song.mp3'
    );
  });
});
