/**
 * POST /api/admin/visual-story/[vsId]/scenes
 *   { op: 'create', heading, summary }            → 201, appended after the last scene
 *   { op: 'update', order, heading?, summary? }
 *   { op: 'delete', order }                       → also removes the scene's shots and candidates
 * Every response carries the recomputed shot timeline and tiling state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { isVsId, sceneInputSchema } from '@/types/visualStory';
import { fail, failRendering, hasRenderingVideo, limitMutation, mapError, timelineOf } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string }> };

const order = z.number().int().min(1);
const bodySchema = z.discriminatedUnion('op', [
  sceneInputSchema.extend({ op: z.literal('create') }),
  sceneInputSchema.partial().extend({ op: z.literal('update'), order }),
  z.object({ op: z.literal('delete'), order }),
]);

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
  const input = parsed.data;

  try {
    const repo = new VisualStoryRepository();
    const tree = await repo.loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);

    let status = 200;
    let scene: { order: number; heading: string; summary: string } | undefined;

    if (input.op === 'create') {
      scene = {
        order: tree.scenes.reduce((m, s) => Math.max(m, s.order), 0) + 1,
        heading: input.heading,
        summary: input.summary,
      };
      await repo.putScene(vsId, scene);
      status = 201;
    } else {
      const existing = tree.scenes.find((s) => s.order === input.order);
      if (!existing) return fail('That scene no longer exists.', 404);
      if (input.op === 'update') {
        scene = {
          ...existing,
          heading: input.heading ?? existing.heading,
          summary: input.summary ?? existing.summary,
        };
        await repo.putScene(vsId, scene);
      } else {
        if (hasRenderingVideo(tree)) return failRendering();
        await repo.deleteScene(vsId, input.order);
      }
    }

    const fresh = (await repo.loadTree(vsId)) ?? tree;
    return NextResponse.json(
      { success: true, data: { scene, scenes: fresh.scenes, ...timelineOf(fresh.story, fresh.shots) } },
      { status }
    );
  } catch (err) {
    return mapError(err);
  }
}
