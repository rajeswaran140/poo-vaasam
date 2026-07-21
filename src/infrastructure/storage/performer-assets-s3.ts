/**
 * performerAssetsS3 — the S3 client + bucket for GATED performer assets
 * (karaoke instrumentals), resolved LAZILY.
 *
 * Gated assets live in a private bucket that is NOT an origin on the public
 * media CloudFront distribution (Option A — see docs/KARAOKE_STEM_PIPELINE.md),
 * so they are unreachable via the CDN by construction and must be read
 * server-side. This is deliberately separate from the media `s3Client`
 * (`BUCKET_NAME` = the public-CDN media bucket).
 *
 * Resolution is lazy — `resolvePerformerAssetsBucket()` throws when
 * `PERFORMER_ASSETS_BUCKET` is unset, so it must NOT run at import time (that
 * would break every module that transitively imports the serving layer in envs
 * where gated assets aren't configured). Call `performerAssetsS3()` only on the
 * gated read path.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { s3Config } from '@/lib/aws-config';
import { resolvePerformerAssetsBucket } from '@/infrastructure/storage/KaraokeInstrumentalStorage';

let cachedClient: S3Client | undefined;

export function performerAssetsS3(): { client: S3Client; bucket: string } {
  const bucket = resolvePerformerAssetsBucket();
  if (!cachedClient) {
    // The gated bucket is us-east-1 — same region as the rest of the S3 media
    // layer (s3Config.region), so this default already matches. Compute runs in
    // ca-central-1 (WEB_COMPUTE); the cross-region read is the same hop every S3
    // access already makes. PERFORMER_ASSETS_REGION is an optional override.
    const region = process.env.PERFORMER_ASSETS_REGION ?? s3Config.region;
    cachedClient = new S3Client({ region, credentials: s3Config.credentials });
  }
  return { client: cachedClient, bucket };
}
