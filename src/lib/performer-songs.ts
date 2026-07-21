/**
 * Server-side data access for the gated "For Performers" portal. Thin layer over
 * the Content repository + S3 presigner so the route handlers stay declarative
 * and the gated read logic lives in one testable place (mirrors site-analytics).
 *
 * Everything here is server-only and assumes the caller has already passed
 * `requirePerformer` — these functions do NO auth of their own.
 */

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { performerAssetsS3 } from '@/infrastructure/storage/performer-assets-s3';
import { ContentType, ContentStatus } from '@/types/content';
import { PerformerSong, type PerformerListItemDTO } from '@/domain/songs/PerformerSong';

// Generous bound — the catalogue is ~30 songs; performable ones are a subset.
const LIST_SCAN_LIMIT = 200;

/** Published songs that are performable (have gated lyrics + a backing track). */
export async function listPerformableSongs(): Promise<PerformerListItemDTO[]> {
  const repo = new ContentRepository();
  const page = await repo.findByType(ContentType.SONGS, {
    status: ContentStatus.PUBLISHED,
    limit: LIST_SCAN_LIMIT,
  });
  const out: PerformerListItemDTO[] = [];
  for (const content of page.items) {
    const song = PerformerSong.fromContent(content);
    if (song) out.push(song.toListJSON());
  }
  return out;
}

/**
 * Fetch one performable song by id. Returns the read-model (which carries the
 * server-only `instrumentalKey` for presigning), or null when the song is
 * missing / unpublished / not performable.
 */
export async function getPerformableSong(id: string): Promise<PerformerSong | null> {
  const repo = new ContentRepository();
  const content = await repo.findById(id);
  if (!content) return null;
  return PerformerSong.fromContent(content);
}

export interface InstrumentalStream {
  body: ReadableStream;
  contentType: string;
  contentLength?: number;
  contentRange?: string;
  /** 206 when an HTTP Range was satisfied (audio seeking), else 200. */
  statusCode: 200 | 206;
}

/**
 * Stream a backing-track object straight from S3 to the caller. We deliberately
 * DO NOT hand out a presigned/CDN URL. The bytes live in the GATED bucket, which
 * is not an origin on the public media CloudFront distribution (Option A), so it
 * has no public address at all; streaming through this server route — only
 * reachable behind `requirePerformer` — is the gate. Range is passed through so
 * the browser can seek (206).
 */
export async function streamInstrumental(key: string, range?: string): Promise<InstrumentalStream> {
  const { client, bucket } = performerAssetsS3();
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, ...(range ? { Range: range } : {}) })
  );
  const body = (res.Body as { transformToWebStream(): ReadableStream }).transformToWebStream();
  return {
    body,
    contentType: res.ContentType || 'audio/mpeg',
    contentLength: typeof res.ContentLength === 'number' ? res.ContentLength : undefined,
    contentRange: res.ContentRange,
    statusCode: res.ContentRange ? 206 : 200,
  };
}
