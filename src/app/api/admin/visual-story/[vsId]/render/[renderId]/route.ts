/**
 * GET /api/admin/visual-story/[vsId]/render/[renderId] — a render's status,
 * polled by the render panel. A render the worker can no longer be running is
 * failed here (conditionally) so the panel never waits forever.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { isRenderId, isVsId } from '@/types/visualStory';
import { fail, mapError } from '@/lib/visual-story-route';
import { sweepStaleRenders } from '@/lib/visual-story-render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string; renderId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { vsId, renderId } = await params;
  if (!isVsId(vsId) || !isRenderId(renderId)) return fail('That render no longer exists.', 404);
  try {
    const repo = new VisualStoryRepository();
    const render = await repo.getRender(vsId, renderId);
    if (!render) return fail('That render no longer exists.', 404);
    const [current] = await sweepStaleRenders(repo, vsId, [render]);
    return NextResponse.json({ success: true, data: { render: current } });
  } catch (err) {
    return mapError(err);
  }
}
