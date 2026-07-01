/**
 * POST /api/admin/lyric-drafts/[id]/versions — save a new version of an existing
 * draft (the current text + optionally the critique just produced for it).
 * Returns the full updated draft. Admin-gated, force-dynamic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { LyricDraftRepository } from '@/infrastructure/database/LyricDraftRepository';
import { addVersionSchema } from '@/types/lyricDraft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const validId = (id: string) => /^draft_[a-z0-9_]+$/i.test(id);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request); // mutation — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!validId(id)) return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = addVersionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid version' },
      { status: 400 }
    );
  }

  try {
    const draft = await new LyricDraftRepository().addVersion(id, parsed.data);
    return NextResponse.json({ success: true, draft }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 });
    }
    console.error('[POST /api/admin/lyric-drafts/[id]/versions] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to save version' }, { status: 500 });
  }
}
