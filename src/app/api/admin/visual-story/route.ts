/**
 * /api/admin/visual-story
 *   GET  [?masterJobId=]  → { success, data: VisualStory[], inflightCount }
 *   POST                  → 201 { success, data: VisualStory }
 *
 * A story is anchored to a SAVED master (audioKey = the master's masterKey)
 * and a whole-second window inside that master's recorded length.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { visualStoryLimiter } from '@/lib/visual-story-rate-limit';
import { isValidMasterJobId } from '@/lib/stems';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { createStorySchema } from '@/types/visualStory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status });

const mss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const masterJobId = request.nextUrl.searchParams.get('masterJobId');
  if (masterJobId !== null && !isValidMasterJobId(masterJobId)) {
    return fail('Invalid masterJobId', 400);
  }
  try {
    const repo = new VisualStoryRepository();
    const stories = masterJobId ? await repo.listByMaster(masterJobId) : await repo.list();
    // One small COUNT query per story; a failed count blanks that row only.
    const data = await Promise.all(
      stories.map(async (story) => {
        try {
          return { ...story, shotCount: await repo.countShots(story.vsId) };
        } catch {
          return { ...story, shotCount: null };
        }
      })
    );
    // Drives the "Check rendering videos (N)" button; a failed count hides it, never the list.
    let inflightCount = 0;
    try {
      inflightCount = (await repo.listInflight()).length;
    } catch {
      /* keep 0 */
    }
    return NextResponse.json({ success: true, data, inflightCount });
  } catch (err) {
    console.error('visual-story list failed', err instanceof Error ? err.name : 'error');
    return fail('Could not load stories.', 500);
  }
}

export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = await requireAdmin(request);
    requireBearer(request); // mutation — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }

  const rl = visualStoryLimiter.check(auth.userId || auth.email || clientIp(request));
  if (!rl.allowed) return rateLimitedResponse(rl);

  const body = await request.json().catch(() => null);
  const parsed = createStorySchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message || 'Invalid request body', 400);
  }
  const input = parsed.data;
  if (!isValidMasterJobId(input.masterJobId)) return fail('Invalid request body', 400);
  if (!Number.isInteger(input.windowStartSec) || !Number.isInteger(input.windowEndSec)) {
    return fail('The window must start and end on whole seconds.', 400);
  }

  try {
    const master = await new MasterJobRepository().get(input.masterJobId);
    if (!master) return fail('That master no longer exists.', 404);
    if (!master.savedAt) return fail('Save this master in the library first.', 400);
    if (!master.masterKey) return fail("This master hasn't finished mastering.", 400);
    if (master.editedDurationSec == null) {
      return fail('This master has no recorded length. Re-open it in Mastering and save it again.', 400);
    }
    if (input.windowEndSec > master.editedDurationSec) {
      return fail(`The window ends after the song does (song is ${mss(master.editedDurationSec)}).`, 400);
    }
    if (input.contentId) {
      const content = await new ContentRepository().findById(input.contentId);
      if (!content) return fail('That content item no longer exists.', 404);
    }

    const story = await new VisualStoryRepository().create({ ...input, audioKey: master.masterKey });
    return NextResponse.json({ success: true, data: story }, { status: 201 });
  } catch (err) {
    console.error('visual-story create failed', err instanceof Error ? err.name : 'error');
    return fail('Could not create the story.', 500);
  }
}
