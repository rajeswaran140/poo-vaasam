/**
 * PUT    /api/admin/lexicon/[id] — update a word (incl. archive via {archived}).
 * DELETE /api/admin/lexicon/[id] — hard-delete a word.
 * Admin-gated, force-dynamic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { lexiconWordUpdateSchema } from '@/types/lexicon';

export const dynamic = 'force-dynamic';

const validId = (id: string) => /^lex_[a-z0-9_]+$/i.test(id);

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  if (!id || !validId(id)) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = lexiconWordUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid update', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const updated = await new LexiconRepository().update(id, parsed.data);
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      return NextResponse.json({ success: false, error: 'Word not found' }, { status: 404 });
    }
    console.error('[PUT /api/admin/lexicon/[id]] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to update word' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  if (!id || !validId(id)) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }

  try {
    await new LexiconRepository().delete(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/admin/lexicon/[id]] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to delete word' }, { status: 500 });
  }
}
