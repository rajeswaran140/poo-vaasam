/**
 * PATCH /api/admin/songs/[id]/theme
 *
 * Persist a per-song theme override on the Content row. Lets admins flip a
 * song between காதல் / அன்னை / இயற்கை / தமிழ் / தாயகம் from the songs
 * dashboard without editing src/config/song-themes.ts in source control.
 *
 * Body: { theme: 'love' | 'mother' | 'nature' | 'tamil' | 'homeland' | '' }
 *   - Empty string clears the override (song falls back to the config map).
 *
 * Admin-gated. The write is a single DynamoDB UPDATE on the METADATA item;
 * it doesn't touch any other field (audio, video, body, status, etc.).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { SONG_THEMES } from '@/config/song-themes';
import { setSongTheme } from '@/lib/song-theme-write';

const schema = z.object({
  theme: z.union([z.enum(SONG_THEMES as unknown as [string, ...string[]]), z.literal('')]),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
      { success: false, error: 'Invalid theme', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { theme } = parsed.data;

  try {
    await setSongTheme(id, theme);
    return NextResponse.json({ success: true, id, theme });
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return NextResponse.json({ success: false, error: 'Song not found' }, { status: 404 });
    }
    console.error('[admin/songs/theme] update failed:', err);
    return NextResponse.json({ success: false, error: 'DB write failed' }, { status: 500 });
  }
}
