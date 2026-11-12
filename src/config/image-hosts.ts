/**
 * The only hosts the next/image optimizer may fetch from.
 *
 * Every stored picture is on our media CDN (MEDIA_BASE_URL) or a YouTube
 * thumbnail (checked against the content table 2026-11-12). The old patterns
 * were `**.amazonaws.com` and `**.cloudfront.net`, which anyone can create, so
 * /_next/image would fetch and decode a stranger's file; the Next.js image
 * optimizer advisories (GHSA-2xp9-vwfh-vxw4, GHSA-2464-fhr4-w9xw) are exploited
 * through exactly such an attacker-chosen image. Listing our own hosts keeps
 * the optimizer to files we put there.
 *
 * Lives here (not in next.config.ts) so it can be unit tested; next.config
 * imports it relatively because the `@/` alias is not available that early.
 */

/** The media CDN when MEDIA_BASE_URL is unset (matches next.config's env default). */
export const DEFAULT_MEDIA_BASE_URL = 'https://d2cdoh43143xxa.cloudfront.net';
const BUCKET = 'tamil-web-media';

export interface ImageHost {
  protocol: 'https';
  hostname: string;
}

/** Host of a base URL, or null when it is not an https URL. */
function httpsHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

type HostEnv = Partial<Record<'MEDIA_BASE_URL' | 'S3_BUCKET' | 'NEXT_PUBLIC_S3_BUCKET', string | undefined>>;

export function imageRemotePatterns(env: HostEnv = process.env as HostEnv): ImageHost[] {
  const bucket = env.S3_BUCKET || env.NEXT_PUBLIC_S3_BUCKET || BUCKET;
  const hosts = [
    httpsHost(env.MEDIA_BASE_URL) ?? httpsHost(DEFAULT_MEDIA_BASE_URL)!,
    // A media URL built before MEDIA_BASE_URL is set points straight at the bucket (aws-config.ts).
    `${bucket}.s3.us-east-1.amazonaws.com`,
    `${bucket}.s3.amazonaws.com`,
    'i.ytimg.com',
  ];
  return [...new Set(hosts)].map((hostname) => ({ protocol: 'https', hostname }));
}
