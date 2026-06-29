/**
 * GET  /api/admin/lyric-drafts  — list draft summaries, newest-edited first.
 * POST /api/admin/lyric-drafts  — create a draft (version 1) from the current
 *   text; optionally stores the critique just produced for it.
 * Admin-gated, force-dynamic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { LyricDraftRepository } from '@/infrastructure/database/LyricDraftRepository';
import { createLyricDraftSchema } from '@/types/lyricDraft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  try {
    const drafts = await new LyricDraftRepository().list();
    return NextResponse.json({ success: true, drafts });
  } catch (err) {
    console.error('[GET /api/admin/lyric-drafts] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to load drafts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const parsed = createLyricDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid draft' },
      { status: 400 }
    );
  }

  try {
    const draft = await new LyricDraftRepository().create(parsed.data);
    return NextResponse.json({ success: true, draft }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/admin/lyric-drafts] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to save draft' }, { status: 500 });
  }
}
