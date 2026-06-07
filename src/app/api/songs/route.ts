/**
 * GET /api/songs — the PUBLIC song feed.
 *
 * The stable, versionable contract every client consumes: the on-site player
 * today and the planned Expo app tomorrow (one domain, two clients). No auth —
 * this is published content. The handler is a thin shell: it delegates to the
 * SongCatalog use case and validates the catalog's output against the published
 * Zod contract before serving, so what we emit can't drift from what clients
 * code against.
 *
 * Rendering: force-static. Per the Amplify model this app runs under, the SSR
 * runtime has NO DynamoDB credentials — DynamoDB reads only succeed at BUILD
 * time. So this feed is generated at build (like the /songs page) and served
 * from cache; new songs surface on the next deploy. A force-dynamic route here
 * would 500 in production for want of runtime creds.
 */

import { NextResponse } from 'next/server';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { SongCatalog } from '@/application/use-cases/SongCatalog';
import { publicSongsResponseSchema } from '@/lib/validations/songs';

export const dynamic = 'force-static';
export const revalidate = 300;

export async function GET() {
  try {
    const catalog = new SongCatalog(new ContentRepository());
    const data = await catalog.listPublished();

    const body = { success: true as const, data, total: data.length };
    // Fail loud in dev/build if we ever emit something off-contract.
    publicSongsResponseSchema.parse(body);

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' },
    });
  } catch (err) {
    console.error('[GET /api/songs] failed to build the song feed', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load songs' },
      { status: 500 }
    );
  }
}
