/**
 * GET /api/admin/music-lab/masters — the saved-masters library, newest first.
 *
 * Read-only, so cookie auth is sufficient (no requireBearer — that guards
 * mutations). Returns whole MasterJob records: the library rows show loudness
 * and range, and re-opening one has to drive the same compare player and report
 * as a fresh job, which needs every field.
 *
 * PAGINATED via an opaque `cursor` (DynamoDB's LastEvaluatedKey, base64url'd).
 * Pass the `nextCursor` from a response to fetch the following page; a null
 * `nextCursor` means the end. Previously this returned up to 200 rows and
 * nothing beyond — in a larger library the older masters were unreachable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const sp = new URL(request.url).searchParams;
  const raw = Number(sp.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : DEFAULT_LIMIT;
  const cursor = sp.get('cursor') || undefined;

  try {
    const { masters, nextCursor } = await new MasterJobRepository().listSavedPage(limit, cursor);
    return NextResponse.json({ success: true, masters, count: masters.length, nextCursor });
  } catch (err) {
    console.error('[api/music-lab/masters] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to list masters' }, { status: 502 });
  }
}
