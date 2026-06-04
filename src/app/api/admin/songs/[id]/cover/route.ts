/**
 * POST /api/admin/songs/[id]/cover — generate a cover image for a song.
 * Admin-gated. Generates via OpenAI (prompt from the body, else derived from
 * the song's title + theme), uploads the PNG to S3, sets the song's
 * `featuredImage`, and returns the public URL.
 *
 * Body: { prompt?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { generateCoverArt, defaultCoverPrompt } from '@/services/ai/cover-art';
import { themeForSongWithOverride, SONG_THEME_LABELS, type SongTheme } from '@/config/song-themes';

export const dynamic = 'force-dynamic';

const schema = z.object({ prompt: z.string().max(4000).optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  // Load the song so we can derive a default prompt + confirm it exists.
  let song: Record<string, unknown> | null = null;
  try {
    const repo = new ContentRepository();
    const entity = await repo.findById(id);
    song = entity ? (entity.toObject() as Record<string, unknown>) : null;
  } catch (err) {
    console.error('[api/admin/songs/cover] load failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to load the song.' }, { status: 502 });
  }
  if (!song) {
    return NextResponse.json({ success: false, error: 'Song not found' }, { status: 404 });
  }

  const themeKey = themeForSongWithOverride(id, song.theme) as SongTheme;
  const prompt = parsed.data.prompt?.trim() || defaultCoverPrompt(String(song.title ?? 'Tamil song'), SONG_THEME_LABELS[themeKey]);

  const gen = await generateCoverArt(prompt);
  if (!gen.ok) {
    // 503 for config (key missing), 502 for upstream/other.
    const status = /not configured/i.test(gen.error) ? 503 : 502;
    return NextResponse.json({ success: false, error: gen.error }, { status });
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
    return NextResponse.json({ success: true, data: { featuredImage: url } });
  } catch (err) {
    console.error('[api/admin/songs/cover] store failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Generated the image but failed to save it.' }, { status: 502 });
  }
}
