/**
 * GET    /api/admin/lyric-drafts/[id] — the full draft incl. every version.
 * PATCH  /api/admin/lyric-drafts/[id] — update title / theme / status.
 * DELETE /api/admin/lyric-drafts/[id] — remove the draft and all its versions.
 * Admin-gated, force-dynamic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { LyricDraftRepository } from '@/infrastructure/database/LyricDraftRepository';
import { updateLyricDraftMetaSchema } from '@/types/lyricDraft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const validId = (id: string) => /^draft_[a-z0-9_]+$/i.test(id);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  try {
    const draft = await new LyricDraftRepository().get(id);
    if (!draft) return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 });
    return NextResponse.json({ success: true, draft });
  } catch (err) {
    console.error('[GET /api/admin/lyric-drafts/[id]] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to load draft' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request); // mutation — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = updateLyricDraftMetaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid update' },
      { status: 400 }
    );
  }

  try {
    const draft = await new LyricDraftRepository().updateMeta(id, parsed.data);
    return NextResponse.json({ success: true, draft });
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 });
    }
    console.error('[PATCH /api/admin/lyric-drafts/[id]] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to update draft' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request); // destructive mutation — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  try {
    await new LyricDraftRepository().delete(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/admin/lyric-drafts/[id]] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to delete draft' }, { status: 500 });
  }
}
