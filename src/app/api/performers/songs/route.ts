/**
 * GET /api/performers/songs — the gated performer catalogue.
 *
 * Lists PUBLISHED songs that are performable (have gated lyrics + a backing
 * track). No lyrics or track URLs in this list response — those come from the
 * per-song detail endpoint. Gated by `requirePerformer`; force-dynamic because
 * it's per-session gated and reads DynamoDB at request time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requirePerformer, authErrorResponse } from '@/lib/auth-helper';
import { listPerformableSongs } from '@/lib/performer-songs';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requirePerformer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const data = await listPerformableSongs();
    return NextResponse.json({ success: true, data, total: data.length });
  } catch (err) {
    console.error('[GET /api/performers/songs] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to load songs' }, { status: 500 });
  }
}
