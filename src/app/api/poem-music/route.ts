/**
 * Poem Background Music API
 *
 * GET /api/poem-music?contentId=...&emotion=...&mood=...
 *
 * Returns { url } for an AI-generated (Lyria) instrumental track, cached in S3
 * so each poem is generated at most once. Returns { url: null } when nothing is
 * cached and Lyria is disabled (or on any error) — the client then falls back
 * to the existing royalty-free library.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isLyriaEnabled } from '@/config/lyria';
import { buildMusicPrompt } from '@/lib/utils/musicPrompt';
import { generateMusic } from '@/services/ai/lyria';
import { S3Operations } from '@/infrastructure/storage/s3-client';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const contentId = (searchParams.get('contentId') || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const emotion = searchParams.get('emotion');
  const mood = searchParams.get('mood');

  if (!contentId) {
    return NextResponse.json({ url: null });
  }

  const key = `audio/poem-music/${contentId}.wav`;

  try {
    // Serve the cached track if it exists (works even when generation is off).
    if (await S3Operations.fileExists(key)) {
      const url = await S3Operations.getSignedUrl(key, 21600); // 6h
      return NextResponse.json({ url, cached: true });
    }

    // Not cached — only generate when Lyria is enabled.
    if (!isLyriaEnabled()) {
      return NextResponse.json({ url: null });
    }

    const prompt = buildMusicPrompt(emotion, mood);
    const audio = await generateMusic(prompt);
    await S3Operations.uploadFile({
      key,
      file: audio,
      contentType: 'audio/wav',
      metadata: { contentId, emotion: emotion || '', mood: mood || '' },
    });
    const url = await S3Operations.getSignedUrl(key, 21600);
    return NextResponse.json({ url, cached: false });
  } catch (error) {
    // Never break the reader — fall back to the existing library.
    console.error('[API:POEM_MUSIC] Error:', error);
    return NextResponse.json({ url: null });
  }
}
