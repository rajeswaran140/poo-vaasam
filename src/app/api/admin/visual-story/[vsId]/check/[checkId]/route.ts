/**
 * GET /api/admin/visual-story/[vsId]/check/[checkId] — a check's status, in
 * pollJob's shape ({ status: 'done', result } | { status: 'error', error }).
 * A check the worker can no longer be running is failed here (conditionally).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { sweepStaleCheck } from '@/services/video/check-job';
import { isCheckId, isVsId } from '@/types/visualStory';
import { fail, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string; checkId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { vsId, checkId } = await params;
  if (!isVsId(vsId) || !isCheckId(checkId)) return fail('That check no longer exists.', 404);
  try {
    const repo = new VisualStoryRepository();
    const found = await repo.getCheck(vsId, checkId);
    if (!found) return fail('That check no longer exists.', 404);
    const check = await sweepStaleCheck(repo, vsId, found);
    if (check.status === 'done') {
      return NextResponse.json({ success: true, status: 'done', result: { checkId: check.checkId }, error: null });
    }
    if (check.status === 'failed') {
      return NextResponse.json({
        success: true,
        status: 'error',
        result: null,
        error: { code: check.code ?? 'upstream', message: check.error || 'The check failed. Please try again.' },
      });
    }
    return NextResponse.json({ success: true, status: check.status, result: null, error: null });
  } catch (err) {
    return mapError(err);
  }
}
