/**
 * POST /api/admin/songs/[id]/cover — generate a cover image for a song.
 * Admin-gated. Thin shell over the GenerateSongCover use case (generate via
 * OpenAI from the body prompt, else the song's title + theme → upload → set
 * featuredImage). Body: { prompt?: string }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { generateSongCover } from '@/application/use-cases/GenerateSongCover';

export const dynamic = 'force-dynamic';

const schema = z.object({ prompt: z.string().max(4000).optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    // Defense-in-depth CSRF: reject cookie-only auth on this mutation
    // (matches the pattern on the other admin mutation routes).
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const result = await generateSongCover(id, { prompt: parsed.data.prompt });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, data: { featuredImage: result.featuredImage } });
}
