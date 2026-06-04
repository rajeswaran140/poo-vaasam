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
        await S3Operations.uploadFile({ key, file: buf, contentType: 'image/jpeg' });
        mirrored.add(id);
      } catch {
        /* swallow — the thumbnail will mirror on a later render */
      }
    })
  );
}
