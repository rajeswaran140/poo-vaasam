/**
 * POST /api/admin/visual-story/[vsId]/select — { sceneOrder, shotOrder, candId }
 * Sets the shot's `selectedCandidateId`. The candidate must belong to that
 * shot; one from another shot is a 400.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { isCandId, isVsId } from '@/types/visualStory';
import { fail, limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string }> };

const ord = z.number().int().min(1);
const bodySchema = z.object({
  sceneOrder: ord,
  shotOrder: ord,
  candId: z.string().refine((s) => isCandId(s), 'Unknown image.'),
});

export async function POST(request: NextRequest, { params }: Ctx) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // mutation — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }
  const limited = limitMutation(auth, request);
  if (limited) return limited;
  const { vsId } = await params;
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid request body', 400);
  const { sceneOrder, shotOrder, candId } = parsed.data;

  try {
    const repo = new VisualStoryRepository();
    const tree = await repo.loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);
    const shot = tree.shots.find((s) => s.sceneOrder === sceneOrder && s.shotOrder === shotOrder);
    if (!shot) return fail('That shot no longer exists.', 404);
    const ofShot = tree.candidates.some(
      (c) => c.candId === candId && c.sceneOrder === sceneOrder && c.shotOrder === shotOrder
    );
    if (!ofShot) return fail('That image does not belong to this shot.', 400);

    await repo.selectCandidate(vsId, sceneOrder, shotOrder, candId);
    return NextResponse.json({ success: true, data: { shot: { ...shot, selectedCandidateId: candId } } });
  } catch (err) {
    return mapError(err);
  }
}
