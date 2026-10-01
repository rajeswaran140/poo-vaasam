/**
 * POST /api/admin/music-lab/master/[jobId]/short — cut a vertical hook clip
 * (1080x1920, 30s) from a saved master, for Reels / Instagram / Shorts.
 *
 * The sibling of the `render` route, and deliberately shaped like it: a job,
 * not a response, Event-invoked on the same master-worker Lambda (which already
 * carries the ffmpeg layer and the bucket access). The Studio polls the existing
 * status route — `shortKey` appears on the job when the clip lands.
 *
 * Like `render`, this reads `job.masterKey` and never the web MP3: a clip is the
 * thing most likely to be re-encoded again by whatever platform it is posted to,
 * so it must not start life a generation down.
 *
 * Nothing here publishes. The MP4 lands in the mastering workspace, which is
 * Denied to CloudFront; the operator downloads it and posts it by hand. There is
 * no Meta API in this path and no scheduled posting.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsConfig } from '@/lib/aws-config';
import { planShort, planFullVertical, shortRefusalMessage, SHORT_FPS, SHORT_MOTIONS } from '@/lib/master-short';
import { planSegments, slideshowRefusalMessage } from '@/lib/master-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';

const bodySchema = z.object({
  coverKey: z.string().min(1),
  /**
   * Render the WHOLE song at 1080x1920 instead of a clip — a Facebook video or
   * an Instagram feed post, where vertical is welcome but the 3-minute Reels
   * ceiling does not apply. Mutually exclusive with a window: there is nothing
   * to pick when the answer is "all of it".
   */
  full: z.boolean().optional(),
  /**
   * The window the operator picked on the waveform, or typed. Both or neither:
   * `planShort` treats a half-given window as a caller that does not mean what
   * this route would have to decide for it. Omit both to let the worker find
   * the loudest stretch, which is the original behaviour.
   */
  startSec: z.number().optional(),
  seconds: z.number().optional(),
  /**
   * A vertical slideshow — the SAME list the 16:9 render takes, in seconds
   * into the SONG. The worker decides which of them the clip's window shows.
   */
  covers: z.array(z.object({ coverKey: z.string().min(1), startSec: z.number() })).optional(),
  /** A slow zoom or pan across each image — the clip or the whole song. See SHORT_MOTIONS. */
  motion: z.enum(SHORT_MOTIONS).optional(),
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
    return NextResponse.json({ success: false, error: 'A cover image is required.' }, { status: 400 });
  }

  try {
    const job = await new MasterJobRepository().get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });

    // Every eligibility rule lives in the planner, so the route and the worker
    // cannot disagree about what can produce a short.
    // A full-length render has no window to validate — `planShort`'s window
    // rules are about clip length, which does not apply when the answer is the
    // whole song. Its ELIGIBILITY rules (is this a mastered WAV, is the cover
    // in the workspace) still do, so it is still consulted, just without one.
    const plan = planShort(
      job,
      parsed.data.coverKey,
      parsed.data.full ? {} : { startSec: parsed.data.startSec, seconds: parsed.data.seconds }
    );
    if (!plan.ok) {
      return NextResponse.json(
        { success: false, error: shortRefusalMessage(plan.reason) },
        { status: 409 }
      );
    }

    const moves = Boolean(parsed.data.motion && parsed.data.motion !== 'none');
    // A moving whole song is limited to 8 minutes. Refused HERE when the
    // length is already known, so the operator hears it now and not after a
    // queued job comes back; the worker re-checks against the file itself.
    if (parsed.data.full && moves && typeof job.editedDurationSec === 'number') {
      const fits = planFullVertical(job.editedDurationSec, parsed.data.motion);
      if (!fits.ok) {
        return NextResponse.json({ success: false, error: fits.message }, { status: 409 });
      }
    }

    const covers = parsed.data.covers?.length ? parsed.data.covers : null;
    if (covers) {
      // The worker records the request's cover as the job's cover, so the list
      // must open on it — same rule, same wording, as the 16:9 slideshow.
      if (covers[0].coverKey !== parsed.data.coverKey) {
        return NextResponse.json(
          { success: false, error: 'The cover must be the first image in the slideshow.' },
          { status: 400 }
        );
      }
      // ORDER, COUNT AND KEYS ONLY. The list is timed against the song, so an
      // image that starts after this clip ends is not an error — it is simply
      // not shown — and one that would only flash at the clip's edge is
      // absorbed by the worker. Hence the generous length and the one reason
      // that is let through.
      const timed = planSegments(covers, 1e7, SHORT_FPS);
      if (!timed.ok && timed.reason !== 'segment-too-short') {
        return NextResponse.json(
          { success: false, error: slideshowRefusalMessage(timed.reason) },
          { status: 409 }
        );
      }
    }

    const lambda = new LambdaClient({
      region: awsConfig.region,
      ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
    });
    await lambda.send(
      new InvokeCommand({
        FunctionName: MASTER_WORKER_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(
          JSON.stringify({
            jobId,
            // A distinct shape again: the worker branches on `short` before the
            // mastering guards, so cutting a clip can never re-master (and
            // re-measure) a file that is already finished.
            short: {
              audioKey: plan.audioKey,
              coverKey: plan.coverKey,
              // Absent unless asked for, so the worker's `spec.full` branch is
              // never entered by accident.
              ...(parsed.data.full ? { full: true } : {}),
              // Spread, not `...plan.window`-with-nulls: an absent window must
              // stay ABSENT in the payload, because the worker branches on
              // `!== undefined` to decide whether to measure at all.
              ...(plan.window ?? {}),
              ...(covers ? { covers } : {}),
              // Absent for a still: the event keeps its original shape unless
              // something will move.
              ...(moves ? { motion: parsed.data.motion } : {}),
            },
          })
        ),
      })
    );

    return NextResponse.json(
      { success: true, shortKey: plan.shortKey, window: plan.window, status: 'queued' },
      { status: 202 }
    );
  } catch (err) {
    console.error('[api/music-lab/master/:jobId/short] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not start the short render.' }, { status: 502 });
  }
}
