/**
 * Server-side data access for the gated "For Performers" portal. Thin layer over
 * the Content repository + S3 presigner so the route handlers stay declarative
 * and the gated read logic lives in one testable place (mirrors site-analytics).
 *
 * Everything here is server-only and assumes the caller has already passed
 * `requirePerformer` — these functions do NO auth of their own.
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { ContentType, ContentStatus } from '@/types/content';
import { PerformerSong, type PerformerListItemDTO } from '@/domain/songs/PerformerSong';

/** Backing-track presigned-URL lifetime. Short by design — the URL is re-minted
 *  on each song open, so a leaked link expires quickly. */
export const INSTRUMENTAL_URL_TTL_SECONDS = 300;

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

/** Mint a short-lived presigned GET URL for a backing-track S3 object. */
export function presignInstrumental(key: string): Promise<string> {
  return S3Operations.getSignedUrl(key, INSTRUMENTAL_URL_TTL_SECONDS);
}
