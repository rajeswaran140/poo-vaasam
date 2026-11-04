/**
 * POST /api/admin/visual-story/[vsId]/draft — { lyrics } — ask Claude for a
 * storyboard draft (spec §6.5), under the story's hard budget cap.
 *
 * Money: DRAFT_ESTIMATE_USD is RESERVED before the paid call and SETTLED
 * exactly once afterwards on every path (one `finally`). Billed = the actual
 * token cost on success, 0 on any failure. The client's abort signal is never
 * forwarded (R10).
 *
 * Privacy (spec §12): the pasted lyrics go only to the model. They are never
 * stored, returned or logged — the draft keeps a SHA-256 of them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { generateStoryboard, DEFAULT_MODEL, type StoryboardResult } from '@/services/ai/storyboarder';
import { DRAFT_ESTIMATE_USD, draftCostUsd } from '@/services/video/cost';
import { draftRequestSchema, isVsId, newId } from '@/types/visualStory';
import type { StoryboardDraft } from '@/types/visualStory';
import { fail, limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vsId: string }> };

const STATUS_BY_CODE: Record<string, number> = {
  not_configured: 503,
  billing: 503,
  rate_limit: 429,
};

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

  const { vsId } = await params;
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);

  const parsed = draftRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid request body', 400);
  const { lyrics } = parsed.data;

  const repo = new VisualStoryRepository();
  let tree;
  let reserved: boolean;
  try {
    tree = await repo.loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);
    reserved = await repo.reserve(vsId, DRAFT_ESTIMATE_USD);
  } catch (err) {
    return mapError(err);
  }
  const { story } = tree;
  if (!reserved) {
    return fail(
      `This would go over the story's budget ($${story.spentUsd.toFixed(2)} of $${story.budgetUsdCap.toFixed(2)}).`,
      402
    );
  }

  // From here a reservation is held: exactly one settle, whatever happens.
  let billedUsd = 0;
  try {
    try {
      let result: StoryboardResult;
      try {
        result = await generateStoryboard({
          lyrics,
          windowSec: story.windowEndSec - story.windowStartSec,
          aspectRatio: story.aspectRatio,
          // No request.signal (R10): a closed tab must not turn a billed call into unrecorded spend.
        });
      } catch (err) {
        console.error('visual-story draft: generator threw', err instanceof Error ? err.name : 'error');
        result = { ok: false, code: 'upstream', error: 'The AI service failed to respond. Please try again.' };
      }
      if (!result.ok) {
        // A received-but-unusable response was still billed by the provider.
        if (result.usage) billedUsd = draftCostUsd(result.usage.inputTokens, result.usage.outputTokens);
        return fail(result.error, STATUS_BY_CODE[result.code] ?? 502);
      }

      const { inputTokens, outputTokens } = result.usage;
      const costUsd = draftCostUsd(inputTokens, outputTokens);
      billedUsd = costUsd; // record before anything that can fail

      const draft: StoryboardDraft = {
        draftId: newId('dr'),
        lyricsHash: createHash('sha256').update(lyrics).digest('hex'),
        model: DEFAULT_MODEL,
        inputTokens,
        outputTokens,
        costUsd,
        characters: result.data.characters,
        scenes: result.data.scenes,
        createdAt: new Date().toISOString(),
      };
      await repo.putDraft(vsId, draft);
      return NextResponse.json({ success: true, data: { draft } }, { status: 201 });
    } finally {
      try {
        await repo.settle(vsId, { reservedUsd: DRAFT_ESTIMATE_USD, billedUsd });
      } catch (err) {
        console.error('visual-story draft: settle failed', err instanceof Error ? err.name : 'error');
      }
    }
  } catch (err) {
    return mapError(err);
  }
}
