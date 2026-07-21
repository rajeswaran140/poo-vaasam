/**
 * S3KaraokeInstrumentalStorage — infrastructure adapter for {@link
 * ../../application/ports/karaoke.KaraokeInstrumentalStorage}.
 *
 * Uploads the produced instrumental to a dedicated `performer-tracks/` prefix
 * on the media bucket and returns its **private S3 object key** — deliberately
 * NOT a public `mediaUrl`. The media CDN serves any public URL unsigned, so a
 * gated asset must never be handed a public address; it is streamed later by a
 * gated route that checks {@link ../../domain/songs/KaraokeAsset.isAccessibleBy}.
 *
 * NOTE (go-live): the `performer-tracks/` prefix must be confirmed to be
 * unreachable through the public CloudFront distribution (a distribution
 * behavior/origin check) — app-layer gating alone does not stop a direct CDN
 * fetch of a known key. This is the anti-scraping guarantee's real dependency.
 */

import { readFileSync } from 'node:fs';
import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { s3Config } from '@/lib/aws-config';
import type { KaraokeInstrumentalStorage } from '@/application/ports/karaoke';

/**
 * Resolve the bucket for gated instrumentals — FAIL CLOSED. The default media
 * bucket (`tamil-web-media`) is fronted by a public CloudFront distribution
 * whose default `*` behavior serves every key unsigned (verified 2026-07-21:
 * anonymous GET of a `performer-tracks/` key returned 200). Writing a gated
 * asset there would make it world-downloadable. So this adapter REFUSES to
 * default to the media bucket: an operator must set `PERFORMER_ASSETS_BUCKET`
 * to a bucket that is NOT reachable through the public CDN. See the go-live
 * gate in docs/KARAOKE_STEM_PIPELINE.md.
 */
export function resolvePerformerAssetsBucket(explicit?: string): string {
  const bucket = (explicit ?? process.env.PERFORMER_ASSETS_BUCKET ?? '').trim();
  if (!bucket) {
    throw new Error(
      'Refusing to store a gated instrumental: set PERFORMER_ASSETS_BUCKET to a bucket NOT fronted by the public media CDN ' +
        '(the default media bucket is CDN-public — see the go-live gate in docs/KARAOKE_STEM_PIPELINE.md).'
    );
  }
  if (bucket === s3Config.bucket) {
    throw new Error(
      `Refusing to store a gated instrumental in "${bucket}": that bucket is served by the public media CloudFront distribution. ` +
        'Use a separate private bucket for gated assets.'
    );
  }
  return bucket;
}

/**
 * The gated S3 key for a song's karaoke instrumental. Pure + exported so the
 * convention is unit-testable without S3. `at` is injected for determinism.
 * Lives under `performer-tracks/` (private) — never the public `audio/` prefix.
 */
export function karaokeInstrumentalKey(songId: string, at: Date = new Date()): string {
  const id = songId.trim();
  if (!id) throw new Error('karaokeInstrumentalKey requires a non-empty songId');
  // Sanitise to a safe key segment (S3 keys allow more, but keep it portable).
  const safe = id.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'song';
  return `performer-tracks/${safe}-instrumental-${at.getTime()}.mp3`;
}

export class S3KaraokeInstrumentalStorage implements KaraokeInstrumentalStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly now: () => Date;

  constructor(opts: { bucket?: string; region?: string; now?: () => Date } = {}) {
    // Fail closed: never default to the CDN-public media bucket.
    this.bucket = resolvePerformerAssetsBucket(opts.bucket);
    this.now = opts.now ?? (() => new Date());
    // The gated bucket is us-east-1 (same as the media bucket + the Lambda@Edge
    // runtime). Offline runs from another region MUST set PERFORMER_ASSETS_REGION
    // or the PutObject region-mismatches. Runtime (us-east-1) resolves correctly.
    const region = opts.region ?? process.env.PERFORMER_ASSETS_REGION ?? s3Config.region;
    this.client = new S3Client({ region, credentials: s3Config.credentials });
  }

  async store(input: { songId: string; localPath: string }): Promise<{ objectKey: string; durationSeconds?: number }> {
    const objectKey = karaokeInstrumentalKey(input.songId, this.now());
    const file = readFileSync(input.localPath);
    // Direct PutObject (not S3Operations.uploadFile) precisely because we must
    // NOT derive/return a public mediaUrl for a gated object.
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: file,
        ContentType: 'audio/mpeg',
        Metadata: { songId: input.songId, kind: 'karaoke-instrumental' },
      })
    );
    // Duration is reported by the separator; the use case falls back to it.
    return { objectKey };
  }
}
