/**
 * GenerateSongCover — generate an AI cover image for an existing song, upload it
 * to S3, and set the song's `featuredImage`. Shared by POST
 * /api/admin/songs/[id]/cover and the one-call publish flow.
 *
 * Returns a discriminated result (never throws) so callers — a route or the
 * best-effort publish orchestration — can decide how to surface failures.
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { generateCoverArt, defaultCoverPrompt } from '@/services/ai/cover-art';
import { themeForSongWithOverride, SONG_THEME_LABELS, type SongTheme } from '@/config/song-themes';

export type GenerateSongCoverResult =
  | { ok: true; featuredImage: string }
  | { ok: false; status: number; error: string };

export async function generateSongCover(
  id: string,
  opts?: { prompt?: string }
): Promise<GenerateSongCoverResult> {
  // Load the song to derive a default prompt + confirm it exists.
  let song: Record<string, unknown> | null = null;
  try {
    const entity = await new ContentRepository().findById(id);
    song = entity ? (entity.toObject() as Record<string, unknown>) : null;
  } catch (err) {
    console.error('[GenerateSongCover] load failed:', err instanceof Error ? err.message : String(err));
    return { ok: false, status: 502, error: 'Failed to load the song.' };
  }
  if (!song) return { ok: false, status: 404, error: 'Song not found' };

  const themeKey = themeForSongWithOverride(id, song.theme) as SongTheme;
  const prompt =
    opts?.prompt?.trim() ||
    defaultCoverPrompt(String(song.title ?? 'Tamil song'), SONG_THEME_LABELS[themeKey]);

  const gen = await generateCoverArt(prompt);
  if (!gen.ok) {
    const status = /not configured/i.test(gen.error) ? 503 : 502; // 503 = key missing
    return { ok: false, status, error: gen.error };
  }

  try {
    const key = `images/song-covers/${id}-${Date.now()}.png`;
    const { url } = await S3Operations.uploadFile({
      key,
      file: Buffer.from(gen.base64, 'base64'),
      contentType: 'image/png',
    });
    await DynamoDBOperations.update({
      key: { PK: `CONTENT#${id}`, SK: 'METADATA' },
      updateExpression: 'SET featuredImage = :u, updatedAt = :t',
      expressionAttributeValues: { ':u': url, ':t': new Date().toISOString() },
      conditionExpression: 'attribute_exists(PK)',
    });
    return { ok: true, featuredImage: url };
  } catch (err) {
    console.error('[GenerateSongCover] store failed:', err instanceof Error ? err.message : String(err));
    return { ok: false, status: 502, error: 'Generated the image but failed to save it.' };
  }
}
