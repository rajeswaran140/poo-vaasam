/**
 * GET /api/admin/youtube/comments?max=100
 *
 * Channel-wide viewer-comment triage for /admin/comments. Reads via the Data
 * API `commentThreads.list` (API key — a public read; no OAuth), classifies
 * which comments still need an owner reply, and returns them unanswered-first.
 *
 * Admin-gated. 503 when YouTube isn't configured; 502 on an upstream failure.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { SITE, isYouTubeVideosConfigured } from '@/config/site';
import {
  fetchChannelComments,
  sortForTriage,
  summarizeComments,
  isCommentsConfigured,
} from '@/lib/youtube-comments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isCommentsConfigured() || !isYouTubeVideosConfigured()) {
    return NextResponse.json(
      { success: false, error: 'YouTube not configured (YOUTUBE_API_KEY / channelId)' },
      { status: 503 }
    );
  }

  const raw = Number(request.nextUrl.searchParams.get('max') ?? '50');
  const max = Number.isFinite(raw) ? Math.max(10, Math.min(200, raw)) : 50;

  try {
    const comments = sortForTriage(await fetchChannelComments(SITE.youtube.channelId, max));
    return NextResponse.json({ success: true, comments, summary: summarizeComments(comments) });
  } catch (err) {
    console.error('[admin/youtube/comments] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to load comments' }, { status: 502 });
  }
}
