/**
 * POST /api/admin/visual-story/[vsId]/draft/[draftId]/apply — replace the
 * story's scenes and shots with the draft's, move the story to STORYBOARDING
 * and return the whole tree. No body, no cost.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { isDraftId, isVsId } from '@/types/visualStory';
import { fail, limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string; draftId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // destructive mutation — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }
  const limited = limitMutation(auth, request);
  if (limited) return limited;

  const { vsId, draftId } = await params;
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);
  if (!isDraftId(draftId)) return fail('That draft no longer exists.', 404);

  try {
    const repo = new VisualStoryRepository();
    await repo.applyDraft(vsId, draftId);
    await repo.patch(vsId, { status: 'STORYBOARDING' });
    const tree = await repo.loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);
    return NextResponse.json({ success: true, data: tree });
  } catch (err) {
    return mapError(err);
  }
}
