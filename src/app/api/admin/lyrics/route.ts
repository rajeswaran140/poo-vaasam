/**
 * Admin Lyrics API — manage which songs expose their lyrics behind the email
 * gate, and edit the lyrics (`body`) themselves.
 *
 *   GET   /api/admin/lyrics
 *           → all SONGS with { id, title, titleSlug, hasBody, showLyrics, status }
 *   PATCH /api/admin/lyrics  { id, showLyrics?, body? }
 *           → toggle showLyrics and/or replace the lyrics body (+ updatedAt)
 *
 * Admin-gated (requireAdmin); PATCH also requires a Bearer token (requireBearer)
 * for CSRF defense-in-depth, like other admin mutations. force-dynamic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { listRawSongs, getRawSongById } from '@/lib/lyrics-content';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    // ?id=<id> → one song WITH its full lyrics body (for the inline editor).
    const id = request.nextUrl.searchParams.get('id');
    if (id) {
      const song = await getRawSongById(id);
      if (!song) {
        return NextResponse.json({ success: false, error: 'Song not found' }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        song: {
          id: song.id,
          title: song.title,
          titleSlug: song.titleSlug ?? '',
          body: song.body ?? '',
          showLyrics: !!song.showLyrics,
          status: song.status ?? '',
        },
      });
    }

    const songs = await listRawSongs();
    const data = songs.map((s) => ({
      id: s.id,
      title: s.title,
      titleSlug: s.titleSlug ?? '',
      hasBody: !!(s.body && s.body.trim().length > 0),
      showLyrics: !!s.showLyrics,
      status: s.status ?? '',
    }));
    return NextResponse.json({ success: true, data, total: data.length });
  } catch (error) {
    console.error('[API:ADMIN_LYRICS] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch songs' },
      { status: 500 }
    );
  }
}

const patchSchema = z
  .object({
    id: z.string().min(1).max(80).trim(),
    showLyrics: z.boolean().optional(),
    body: z.string().max(20000).optional(),
  })
  .refine((d) => d.showLyrics !== undefined || d.body !== undefined, {
    message: 'Nothing to update',
  });

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', errors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { id, showLyrics, body: lyricsBody } = parsed.data;

    // Build a dynamic SET expression covering only the supplied fields. `body`
    // is a reserved word → alias it; always stamp updatedAt.
    const sets: string[] = ['#updatedAt = :updatedAt'];
    const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = { ':updatedAt': new Date().toISOString() };

    if (showLyrics !== undefined) {
      sets.push('#showLyrics = :showLyrics');
      names['#showLyrics'] = 'showLyrics';
      values[':showLyrics'] = showLyrics;
    }
    if (lyricsBody !== undefined) {
      sets.push('#body = :body');
      names['#body'] = 'body';
      values[':body'] = lyricsBody;
    }

    try {
      await DynamoDBOperations.update({
        key: { PK: `CONTENT#${id}`, SK: 'METADATA' },
        updateExpression: `SET ${sets.join(', ')}`,
        expressionAttributeNames: names,
        expressionAttributeValues: values,
        conditionExpression: 'attribute_exists(PK)',
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        return NextResponse.json({ success: false, error: 'Song not found' }, { status: 404 });
      }
      throw e;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API:ADMIN_LYRICS] PATCH error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update lyrics' },
      { status: 500 }
    );
  }
}
