/**
 * POST /api/admin/visual-story/[vsId]/characters
 *   { op: 'create', name, description }              → 201
 *   { op: 'update', charId, name?, description? }
 * Reference images are attached only through the upload route's confirm step,
 * never through this body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { isVsId, isCharId, newId, characterInputSchema } from '@/types/visualStory';
import type { Character } from '@/types/visualStory';
import { fail, limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string }> };

const bodySchema = z.discriminatedUnion('op', [
  characterInputSchema.extend({ op: z.literal('create') }),
  characterInputSchema
    .partial()
    .extend({ op: z.literal('update'), charId: z.string().refine(isCharId, 'Invalid character') }),
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

    let character: Character;
    let status = 200;
    if (input.op === 'create') {
      character = {
        charId: newId('ch'),
        name: input.name,
        description: input.description,
        refImageKeys: [],
        createdAt: new Date().toISOString(),
      };
      status = 201;
    } else {
      const existing = tree.characters.find((c) => c.charId === input.charId);
      if (!existing) return fail('That character no longer exists.', 404);
      character = {
        ...existing,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
      };
    }
    await repo.putCharacter(vsId, character);
    return NextResponse.json({ success: true, data: { character } }, { status });
  } catch (err) {
    return mapError(err);
  }
}
