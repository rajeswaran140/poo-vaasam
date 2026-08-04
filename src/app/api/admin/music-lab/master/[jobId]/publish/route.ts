/**
 * POST /api/admin/music-lab/master/[jobId]/publish — stage a saved master's web
 * MP3 at the site's own audio path (`audio/poem-music/<Tamil title>.mp3`).
 *
 * Closes the module's last manual step. Until now the MP3 came back as a
 * download, so getting it onto tamilagaval.com meant saving it, renaming it in
 * Tamil by hand, and re-uploading — for a file that was already sitting in the
 * same bucket, already measured. Both prefixes are in `tamil-web-media`, so the
 * copy is server-side: nothing travels through this Lambda.
 *
 * ⚠️ STAGING, NOT GOING LIVE. `/songs` is build-time SSG, so the audio appears
 * on the site only once a content record points at it and Amplify rebuilds.
 * The response says so; so does the button.
 *
 * A destination that already exists returns 409 with `conflict: true` rather
 * than replacing it — that key is what listeners hear for a published song, and
 * only the admin knows whether the file there is the same one. Re-post with
 * `overwrite: true` to replace (the bucket is versioned, so it is recoverable).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { publishWebMp3 } from '@/lib/master-publish-service';
import { mediaUrl } from '@/lib/aws-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  overwrite: z.boolean().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { jobId } = await params;
  if (!jobId) return NextResponse.json({ success: false, error: 'jobId required' }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }

  try {
    const job = await new MasterJobRepository().get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });

    const outcome = await publishWebMp3(jobId, job, { overwrite: parsed.data.overwrite });

    if (outcome.conflict) {
      // Not an error — a question. 409 so the client can tell this apart from a
      // refusal it cannot resolve.
      return NextResponse.json(
        { success: false, conflict: true, key: outcome.key, error: outcome.message },
        { status: 409 }
      );
    }
    if (!outcome.published) {
      return NextResponse.json({ success: false, error: outcome.message }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      key: outcome.key,
      url: outcome.key ? mediaUrl(outcome.key) : null,
      replaced: Boolean(outcome.replaced),
      // Stated in the payload, not just the UI, so any future caller inherits
      // the caveat rather than assuming a copied object means a live song.
      note: 'Staged in S3. The song appears on the site once a content record points at it and the site rebuilds.',
    });
  } catch (err) {
    console.error('[api/music-lab/master/:jobId/publish] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to publish master' }, { status: 502 });
  }
}
