/**
 * POST /api/admin/visual-story/[vsId]/shots
 *   { op: 'create', sceneOrder, mode, durationSec, visualPrompt, negativePrompt?, charIds? }
 *   { op: 'update', sceneOrder, shotOrder, …any shot field, firstFrameCandidateId (a STILL of this shot, or null to clear) }
 *   { op: 'delete', sceneOrder, shotOrder }
 *   { op: 'reorder', sceneOrder, order: [current shotOrders in the new sequence] }
 * Every response carries the shots with recomputed startSec and whether they
 * tile the story's window. Orders are 1-based.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { isVsId, shotInputSchema } from '@/types/visualStory';
import type { Shot } from '@/types/visualStory';
import { fail, failRendering, hasRenderingVideo, limitMutation, mapError, timelineOf } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string }> };

const ord = z.number().int().min(1);
const bodySchema = z.discriminatedUnion('op', [
  shotInputSchema
    .extend({
      op: z.literal('create'),
      sceneOrder: ord,
      negativePrompt: z.string().trim().max(1000).default(''),
      charIds: z.array(z.string()).max(14).default([]),
    }),
  shotInputSchema.partial().extend({
    op: z.literal('update'),
    sceneOrder: ord,
    shotOrder: ord,
    firstFrameCandidateId: z.string().min(1).nullable().optional(),
  }),
  z.object({ op: z.literal('delete'), sceneOrder: ord, shotOrder: ord }),
  z.object({ op: z.literal('reorder'), sceneOrder: ord, order: z.array(ord).min(1).max(100) }),
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
    if (!tree.scenes.some((s) => s.order === input.sceneOrder)) {
      return fail('That scene no longer exists.', 404);
    }
    const known = new Set(tree.characters.map((c) => c.charId));
    const sceneShots = tree.shots.filter((s) => s.sceneOrder === input.sceneOrder);
    const find = (shotOrder: number) => sceneShots.find((s) => s.shotOrder === shotOrder);

    let status = 200;
    let shot: Shot | undefined;

    if (input.op === 'create') {
      if (!input.charIds.every((id) => known.has(id))) return fail('Unknown character.', 400);
      const { op: _op, ...fields } = input;
      shot = {
        ...fields,
        shotOrder: sceneShots.reduce((m, s) => Math.max(m, s.shotOrder), 0) + 1,
        startSec: 0, // derived on read
        selectedCandidateId: null,
      };
      await repo.putShot(vsId, shot);
      status = 201;
    } else if (input.op === 'update') {
      const existing = find(input.shotOrder);
      if (!existing) return fail('That shot no longer exists.', 404);
      if (input.charIds && !input.charIds.every((id) => known.has(id))) return fail('Unknown character.', 400);
      const { op: _op, sceneOrder: _s, shotOrder: _o, firstFrameCandidateId: frame, ...changes } = input;
      shot = { ...existing, ...changes };
      if (frame === null) {
        delete shot.firstFrameCandidateId; // putShot replaces the item, so omitting the key clears it
      } else if (frame !== undefined) {
        // Same rule as buildVideoRequest: a STILL of this very shot.
        const ok = tree.candidates.some(
          (c) =>
            c.candId === frame &&
            c.mode === 'STILL' &&
            c.sceneOrder === existing.sceneOrder &&
            c.shotOrder === existing.shotOrder
        );
        if (!ok) return fail("Pick one of this shot's still pictures.", 400);
        shot.firstFrameCandidateId = frame;
      }
      await repo.putShot(vsId, shot);
    } else if (input.op === 'delete') {
      if (!find(input.shotOrder)) return fail('That shot no longer exists.', 404);
      if (hasRenderingVideo(tree)) return failRendering();
      await repo.deleteShot(vsId, input.sceneOrder, input.shotOrder);
    } else {
      if (hasRenderingVideo(tree)) return failRendering();
      await repo.reorderShots(vsId, input.sceneOrder, input.order);
    }

    const fresh = (await repo.loadTree(vsId)) ?? tree;
    return NextResponse.json(
      { success: true, data: { shot, ...timelineOf(fresh.story, fresh.shots) } },
      { status }
    );
  } catch (err) {
    return mapError(err);
  }
}
