/**
 * Poem Background Music API
 *
 * GET /api/poem-music?contentId=...&emotion=...&mood=...
 *
 * Returns { url } for an AI-generated (Lyria) instrumental track, cached in S3
 * so each poem is generated at most once. Returns { url: null } when nothing is
 * cached and Lyria is disabled (or on any error) — the client then falls back
 * to the existing royalty-free library.
 *
 * ABUSE GUARDS. This is an unauthenticated GET that can reach a billable Vertex
 * AI call, so it carries the same protections as the other public spend
 * endpoints (see src/lib/rate-limit and api/content/[id]/view):
 *
 *  1. Per-IP rate limit, shared across Lambda instances.
 *  2. Strict `cnt_…` id format check.
 *  3. The id must resolve to REAL PUBLISHED content before anything is
 *     generated. This is the important one: the S3 cache key is derived from
 *     `contentId`, so without it a caller could walk `?contentId=a1`, `a2`,
 *     `a3` … and every request would miss the cache, generate a fresh track and
 *     write a new object — unbounded spend from an anonymous caller. Binding the
 *     key to the published catalogue caps the number of distinct generations at
 *     the number of poems that exist.
 *
 * The existence check deliberately gates GENERATION ONLY, not the cached read:
 * serving an already-paid-for track costs nothing and stays available even if
 * DynamoDB is unhappy, whereas generation is the expensive, irreversible step.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isLyriaEnabled } from '@/config/lyria';
import { buildMusicPrompt } from '@/lib/utils/musicPrompt';
import { generateMusic } from '@/services/ai/lyria';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { SharedRateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// A reader starts music at most once per poem, so this is generous for the real
// client while capping how fast a script can probe the cache / trigger spend.
const limiter = new SharedRateLimiter({ bucket: 'poem-music', windowMs: 60_000, max: 20 });

// Content ids are minted as `cnt_<digits>_<alnum>` (see ContentRepository).
// Mirrors api/content/[id]/view so the two public id checks can't drift.
const CONTENT_ID = /^cnt_[A-Za-z0-9_]+$/;

export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  const { searchParams } = new URL(request.url);
  const contentId = searchParams.get('contentId') || '';
  const emotion = searchParams.get('emotion');
  const mood = searchParams.get('mood');

  // Reject rather than sanitise: silently stripping characters would map several
  // distinct inputs onto one cache key, which is exactly the confusion to avoid
  // now that the key governs spend.
  if (!CONTENT_ID.test(contentId)) {
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

    // …and only for content that actually exists and is published, so the set of
    // generatable cache keys is the catalogue, not the input space.
    const content = await new ContentRepository().findById(contentId);
    if (!content || !content.isPublished()) {
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
    const e = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    console.error('[API:POEM_MUSIC] Error:', e?.name, e?.$metadata?.httpStatusCode, e?.message);
    return NextResponse.json({ url: null });
  }
}
