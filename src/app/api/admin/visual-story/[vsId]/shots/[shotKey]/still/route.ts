/**
 * POST /api/admin/visual-story/[vsId]/shots/[shotKey]/still — generate one
 * STILL candidate for a shot with Grok Imagine (spec §6.4), under the story's
 * hard budget cap (spec §11 layer 3). `shotKey` is `nnn-mmm`
 * (sceneOrder-shotOrder). No body.
 *
 * Money: the estimate is RESERVED before the paid call and SETTLED exactly once
 * afterwards on every path (one `finally`). Billed = the provider says it
 * billed (an image, or a moderated refusal); anything else releases the
 * reservation. A reservation that would cross the cap is refused with 402 and
 * the provider is never called.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { generateStillImage, type ImageResult } from '@/services/video/image-providers';
import { estimateCostUsd } from '@/services/video/cost';
import { candidateKey } from '@/lib/visual-story-storage';
import { isVsId, newId } from '@/types/visualStory';
import type { Candidate, Character, Shot } from '@/types/visualStory';
import { fail, limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string; shotKey: string }> };

const SHOT_KEY = /^(\d{3})-(\d{3})$/;

const STATUS_BY_CODE: Record<string, number> = {
  not_configured: 503,
  billing: 503,
  rate_limit: 429,
  content_policy: 422,
};

/** The shot's prompt plus who is in it, so the frame matches the cast. */
function buildPrompt(shot: Shot, characters: Character[]): string {
  const cast = shot.charIds
    .map((id) => characters.find((c) => c.charId === id))
    .filter((c): c is Character => !!c)
    .map((c) => (c.description.trim() ? `${c.name}: ${c.description.trim()}` : c.name));
  return cast.length ? `${shot.visualPrompt}\n\nCharacters in this shot:\n${cast.join('\n')}` : shot.visualPrompt;
}

export async function POST(request: NextRequest, { params }: Ctx) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // mutation that spends money — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }
  const limited = limitMutation(auth, request);
  if (limited) return limited;

  const { vsId, shotKey } = await params;
  const m = SHOT_KEY.exec(shotKey);
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);
  if (!m) return fail('That shot no longer exists.', 404);
  const sceneOrder = Number(m[1]);
  const shotOrder = Number(m[2]);

  const repo = new VisualStoryRepository();
  let tree;
  let est: number;
  let reserved: boolean;
  try {
    tree = await repo.loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);
    const found = tree.shots.find((s) => s.sceneOrder === sceneOrder && s.shotOrder === shotOrder);
    if (!found) return fail('That shot no longer exists.', 404);
    est = estimateCostUsd('grok', 'STILL', found.durationSec);
    reserved = await repo.reserve(vsId, est);
  } catch (err) {
    return mapError(err);
  }
  if (!reserved) {
    const { spentUsd, budgetUsdCap } = tree.story;
    return fail(
      `This would go over the story's budget ($${spentUsd.toFixed(2)} of $${budgetUsdCap.toFixed(2)}).`,
      402
    );
  }

  // From here a reservation is held: exactly one settle, whatever happens.
  const shot = tree.shots.find((s) => s.sceneOrder === sceneOrder && s.shotOrder === shotOrder)!;
  let billedUsd = 0;
  try {
    try {
      let result: ImageResult;
      try {
        result = await generateStillImage({
          providerId: 'grok-image', // always JPEG, matching the .jpg candidate key
          prompt: buildPrompt(shot, tree.characters),
          aspectRatio: tree.story.aspectRatio,
          signal: request.signal,
        });
      } catch (err) {
        // e.g. SSM failing for a reason other than a missing parameter: nothing was billed.
        console.error('visual-story still: provider threw', err instanceof Error ? err.name : 'error');
        result = { ok: false, code: 'upstream', error: 'Image generation failed. Please try again.', billed: false };
      }
      if (result.billed) billedUsd = est;
      if (!result.ok) return fail(result.error, STATUS_BY_CODE[result.code] ?? 502);

      const candId = newId('cd');
      const s3Key = candidateKey(vsId, candId, 'jpg');
      try {
        await S3Operations.uploadFile({ key: s3Key, file: result.bytes, contentType: result.contentType });
      } catch (err) {
        console.error('visual-story still: S3 put failed', err instanceof Error ? err.name : 'error');
        return fail("The image was made but couldn't be saved; it was still charged.", 502);
      }

      const candidate: Candidate = {
        candId,
        sceneOrder,
        shotOrder,
        jobId: null,
        providerId: 'grok-image',
        providerTaskId: null,
        s3Key,
        costUsd: est,
        mode: 'STILL',
        createdAt: new Date().toISOString(),
      };
      await repo.putCandidate(vsId, candidate);
      return NextResponse.json({ success: true, data: { candidate } }, { status: 201 });
    } finally {
      await repo.settle(vsId, { reservedUsd: est, billedUsd });
    }
  } catch (err) {
    return mapError(err);
  }
}
