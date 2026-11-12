/** @jest-environment node */
/**
 * The image optimizer fetches only from our own hosts. A wildcard like
 * `**.amazonaws.com` lets anyone make /_next/image decode their file, which is
 * how the Next.js image optimizer advisories are exploited (verified live
 * 2026-11-12: a foreign S3 bucket's PNG came back 200 through the optimizer).
 */
import nextConfig from '../../next.config';
import { DEFAULT_MEDIA_BASE_URL, imageRemotePatterns } from '@/config/image-hosts';

const hostsOf = (env: Parameters<typeof imageRemotePatterns>[0]) => imageRemotePatterns(env).map((p) => p.hostname);

it('allows the media CDN, the bucket and YouTube thumbnails, over https only', () => {
  expect(imageRemotePatterns({ MEDIA_BASE_URL: 'https://d2cdoh43143xxa.cloudfront.net/' })).toEqual([
    { protocol: 'https', hostname: 'd2cdoh43143xxa.cloudfront.net' },
    { protocol: 'https', hostname: 'tamil-web-media.s3.us-east-1.amazonaws.com' },
    { protocol: 'https', hostname: 'tamil-web-media.s3.amazonaws.com' },
    { protocol: 'https', hostname: 'i.ytimg.com' },
  ]);
});

it('follows MEDIA_BASE_URL to a new distribution and the bucket name from env', () => {
  expect(hostsOf({ MEDIA_BASE_URL: 'https://dnew123.cloudfront.net', S3_BUCKET: 'other-bucket' })).toEqual([
    'dnew123.cloudfront.net',
    'other-bucket.s3.us-east-1.amazonaws.com',
    'other-bucket.s3.amazonaws.com',
    'i.ytimg.com',
  ]);
});

it('falls back to the default CDN when MEDIA_BASE_URL is unset or not https', () => {
  const fallback = new URL(DEFAULT_MEDIA_BASE_URL).hostname;
  expect(hostsOf({})[0]).toBe(fallback);
  expect(hostsOf({ MEDIA_BASE_URL: 'http://evil.example' })[0]).toBe(fallback);
  expect(hostsOf({ MEDIA_BASE_URL: 'not a url' })[0]).toBe(fallback);
});

it('next.config uses no wildcard host', () => {
  const patterns = nextConfig.images?.remotePatterns ?? [];
  expect(patterns.length).toBeGreaterThan(0);
  for (const p of patterns) {
    const host = typeof p === 'object' && 'hostname' in p ? p.hostname : String(p);
    expect(host).not.toContain('*');
  }
});
