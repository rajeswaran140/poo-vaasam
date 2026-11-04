/**
 * /api/admin/visual-story/[vsId]
 *   GET    → { success, data: tree }
 *   PATCH  { title?, status?, budgetUsdCap? }
 *   DELETE → removes the whole partition
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import {
  VisualStoryRepository,
  VisualStoryDomainError,
  NotFoundError,
  CapBelowCommittedError,
} from '@/infrastructure/database/VisualStoryRepository';
import { isVsId } from '@/types/visualStory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string }> };

const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status });

const patchSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(120).optional(),
    status: z.enum(['DRAFT', 'STORYBOARDING', 'GENERATING', 'REVIEW', 'COMPLETE']).optional(),
    budgetUsdCap: z.number().min(0).max(500).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

function mapError(err: unknown) {
  if (err instanceof CapBelowCommittedError) return fail(err.message, 409);
  if (err instanceof NotFoundError) return fail('That story no longer exists.', 404);
  if (err instanceof VisualStoryDomainError) return fail(err.message, 400);
  console.error('visual-story route failed', err instanceof Error ? err.name : 'error');
  return fail('Something went wrong.', 500);
}

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { vsId } = await params;
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);
  try {
    const tree = await new VisualStoryRepository().loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);
    return NextResponse.json({ success: true, data: tree });
  } catch (err) {
    return mapError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { vsId } = await params;
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid request body', 400);

  try {
    const repo = new VisualStoryRepository();
    const story = await repo.findById(vsId);
    if (!story) return fail('That story no longer exists.', 404);
    const { budgetUsdCap } = parsed.data;
    if (budgetUsdCap !== undefined && budgetUsdCap < story.committedUsd) {
      return fail(
        `The cap can't go below what's already spent or reserved ($${story.committedUsd.toFixed(2)}).`,
        409
      );
    }
    await repo.patch(vsId, parsed.data);
    const updated = await repo.findById(vsId);
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { vsId } = await params;
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);
  try {
    await new VisualStoryRepository().remove(vsId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return mapError(err);
  }
}
