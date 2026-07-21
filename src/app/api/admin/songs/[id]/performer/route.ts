/**
 * PUT /api/admin/songs/[id]/performer
 *
 * Set (or clear) a song's gated performer assets — the lyrics and the karaoke
 * backing track — that power the /performers portal. Admin-gated; a single
 * atomic DynamoDB UPDATE on the song's METADATA item.
 *
 * Body (all optional; omit a field to leave it unchanged):
 *   { lyrics?: string,            // '' clears
 *     instrumentalKey?: string,   // S3 object key of the backing-track MP3; '' clears
 *     instrumentalDuration?: number | null } // seconds; 0/null clears
 *
 * The instrumental MP3 must already be uploaded to the media bucket (via the
 * existing media tooling); this endpoint stores the KEY, which the performer
 * routes presign on demand — the raw object is never publicly fetchable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { setPerformerAssets } from '@/lib/performer-write';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';

export const dynamic = 'force-dynamic';

/**
 * GET — load a song's current performer assets for the admin editor. Verified
 * admin-only (so the gated lyrics are never SSR'd into the page for a
 * cookie-only visitor; the editor fetches them on demand here instead).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  if (!id || !/^cnt_[a-z0-9_]+$/i.test(id)) {
    return NextResponse.json({ success: false, error: 'Bad content id' }, { status: 400 });
  }

  const content = await new ContentRepository().findById(id);
  if (!content) {
    return NextResponse.json({ success: false, error: 'Song not found' }, { status: 404 });
  }
  return NextResponse.json({
    success: true,
    lyrics: content.lyrics ?? '',
    instrumentalKey: content.instrumentalKey ?? '',
    instrumentalDuration: content.instrumentalDuration ?? null,
  });
}

const schema = z
  .object({
    lyrics: z.string().max(50000).optional(),
    instrumentalKey: z.string().max(1024).optional(),
    instrumentalDuration: z.number().int().nonnegative().max(86400).nullable().optional(),
  })
  .refine(
    (v) => v.lyrics !== undefined || v.instrumentalKey !== undefined || v.instrumentalDuration !== undefined,
    { message: 'Provide at least one of lyrics, instrumentalKey, instrumentalDuration' }
  );

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  if (!id || !/^cnt_[a-z0-9_]+$/i.test(id)) {
    return NextResponse.json({ success: false, error: 'Bad content id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    await setPerformerAssets(id, parsed.data);
    return NextResponse.json({ success: true, id });
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return NextResponse.json({ success: false, error: 'Song not found' }, { status: 404 });
    }
    console.error('[admin/songs/performer] update failed:', err);
    return NextResponse.json({ success: false, error: 'DB write failed' }, { status: 500 });
  }
}
