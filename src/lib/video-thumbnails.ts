/**
 * Self-hosted video thumbnails. Instead of hot-linking YouTube's CDN
 * (i.ytimg.com) — which some networks/regions block and which depends on the
 * Next image optimizer — we mirror each video's thumbnail to S3 and serve it
 * from our own bucket. `ensureThumbnailsMirrored` self-heals new uploads, so
 * /videos never depends on YouTube's CDN at view time.
 *
 * Server-only (imports the S3 SDK). Keep `s3ThumbnailUrl` (pure) in
 * youtube-feed.ts so the feed parsers stay free of the AWS SDK.
 */

import { S3Operations } from '@/infrastructure/storage/s3-client';

const PREFIX = 'images/video-thumbs';

// Short CDN cache so a re-mirror (admin "Refresh thumbnails", e.g. after you
// set a Tamil thumbnail on YouTube) propagates through CloudFront within minutes
// instead of waiting out the ~24h default TTL. Thumbnails are tiny + low-traffic
// so the extra revalidation is negligible.
const THUMB_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';

// Ids confirmed present in S3 this process. Once an id is here we never hit S3
// for it again — so warm Lambdas do ZERO S3 work for known videos; only a
// genuinely new upload triggers a HEAD + (maybe) an upload.
const mirrored = new Set<string>();

/** Test-only: clear the in-process "already mirrored" set. */
export function _resetMirrorCache(): void {
  mirrored.clear();
}

/** Fetch a video's thumbnail from YouTube and store it in S3 if not already there. */
export async function ensureThumbnailsMirrored(videoIds: string[]): Promise<void> {
  await Promise.all(
    videoIds.map(async (id) => {
      if (!/^[\w-]{11}$/.test(id) || mirrored.has(id)) return;
      const key = `${PREFIX}/${id}.jpg`;
      try {
        if (await S3Operations.fileExists(key)) {
          mirrored.add(id);
          return; // already in S3
        }
        let res = await fetch(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`);
        if (!res.ok) res = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        await S3Operations.uploadFile({ key, file: buf, contentType: 'image/jpeg', cacheControl: THUMB_CACHE_CONTROL });
        mirrored.add(id);
      } catch {
        /* swallow — the thumbnail will mirror on a later render */
      }
    })
  );
}

/**
 * Force-refresh thumbnails from YouTube, OVERWRITING the S3 mirror even when it
 * already exists (unlike ensureThumbnailsMirrored, which mirrors once). Used by
 * the admin "Refresh thumbnails" action after a thumbnail is changed on YouTube
 * (e.g. swapped to a Tamil custom thumbnail) — the short Cache-Control means the
 * new image shows on /videos within minutes via CloudFront. Always fetches LIVE
 * (no-store) so we never re-mirror a cached copy.
 */
export async function refreshThumbnails(
  videoIds: string[]
): Promise<{ refreshed: string[]; failed: string[] }> {
  const refreshed: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    videoIds.map(async (id) => {
      if (!/^[\w-]{11}$/.test(id)) { failed.push(id); return; }
      const key = `${PREFIX}/${id}.jpg`;
      try {
        let res = await fetch(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, { cache: 'no-store' });
        if (!res.ok) res = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, { cache: 'no-store' });
        if (!res.ok) { failed.push(id); return; }
        const buf = Buffer.from(await res.arrayBuffer());
        await S3Operations.uploadFile({ key, file: buf, contentType: 'image/jpeg', cacheControl: THUMB_CACHE_CONTROL });
        mirrored.add(id);
        refreshed.push(id);
      } catch {
        failed.push(id);
      }
    })
  );
  return { refreshed, failed };
}
