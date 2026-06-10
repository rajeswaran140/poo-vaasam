/**
 * POST /api/content/[id]/view — record one on-site view.
 *
 * The public content pages are statically generated (see content/[id]/page.tsx),
 * so a visit never runs server code that could bump a counter. This lightweight
 * beacon — fired once per session by the client ViewTracker — is how the
 * DynamoDB `viewCount` actually accrues. (GA4 separately tracks pageviews for
 * analytics; this is the on-site counter used for sort/"popular".)
 *
 * Design:
 *  - Only PUBLISHED content accrues views. An unknown/draft id is a silent no-op
 *    (counted:false) — we don't leak existence and the beacon stays dumb.
 *  - Rate-limited per IP so a scripted client can't inflate the counter on a
 *    warm instance (reuses src/lib/rate-limit; same approach as the AI/TTS
 *    endpoints). Runtime DynamoDB writes work here exactly like /api/subscribe.
 *  - A counter failure must NEVER surface to the visitor — the client ignores
 *    the response either way.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { RateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One view per visitor/session is the norm; this caps a single scripted client
// hammering the counter on one warm instance.
const limiter = new RateLimiter({ windowMs: 60_000, max: 60 });

// Content ids are minted as `cnt_<digits>_<alnum>` (see ContentRepository).
const CONTENT_ID = /^cnt_[A-Za-z0-9_]+$/;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rl = checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  const { id } = await params;
  if (!id || !CONTENT_ID.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid content id' }, { status: 400 });
  }

  try {
    const repo = new ContentRepository();
    const content = await repo.findById(id);
    if (content && content.isPublished()) {
      await repo.incrementViewCount(id);
      return NextResponse.json({ success: true, counted: true }, { status: 200 });
    }
    // Unknown or unpublished — accept the beacon but count nothing.
    return NextResponse.json({ success: true, counted: false }, { status: 200 });
  } catch (err) {
    console.error('[api/content/view] increment failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, counted: false }, { status: 500 });
  }
}
