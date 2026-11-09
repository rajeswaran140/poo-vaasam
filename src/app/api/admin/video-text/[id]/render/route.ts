/**
 * POST — start a render. Claims the project's render slot, then Event-invokes
 * the master-worker; progress is read from the project by polling.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VideoTextRepository } from '@/infrastructure/database/VideoTextRepository';
import { awsConfig } from '@/lib/aws-config';
import { isValidProjectId } from '@/lib/video-text/keys';
import { validateBlocks } from '@/lib/video-text/timeline';
import { validateCut } from '@/lib/video-text/cut';
import { validateFreeze } from '@/lib/video-text/freeze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';
const START_FAILED = 'The render could not be started — try again.';

const CHANGED = 'This project was changed in another tab — reload, then press Make video again.';

/** `version`: the project version the PNGs were drawn from; the render is claimed only at that version. */
const schema = z.object({ renderId: z.string(), version: z.number().int().positive() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isValidProjectId(parsed.data.renderId)) {
    return NextResponse.json({ error: 'Invalid render request.' }, { status: 400 });
  }
  const { renderId, version } = parsed.data;

  try {
    const repo = new VideoTextRepository();
    // Consistent: this follows the pre-render save (PATCH); a stale read would miss it.
    const project = await repo.get(id, { consistent: true });
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    if (project.version !== version) return NextResponse.json({ error: CHANGED }, { status: 409 });
    if (!project.source) return NextResponse.json({ error: 'Upload a video first.' }, { status: 400 });
    if (new Date(project.source.expiresAt).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'The uploaded video was deleted after 30 days — upload it again; your timing is kept.' },
        { status: 410 }
      );
    }
    const problem = validateBlocks(project.blocks, project.source.durationSec) ?? validateCut(project.cut, project.source.durationSec) ?? validateFreeze(project.freeze, project.source.durationSec);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    // Conditional on the version too: a save that lands between the read and
    // the claim would otherwise render blocks nobody drew PNGs for.
    const claimed = await repo.startRender(id, renderId, version);
    if (!claimed.ok) {
      if (claimed.reason === 'missing') return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
      if (claimed.reason === 'changed') return NextResponse.json({ error: CHANGED }, { status: 409 });
      return NextResponse.json({ error: 'A render is already running.' }, { status: 409 });
    }

    try {
      const lambda = new LambdaClient({
        region: awsConfig.region,
        ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
      });
      await lambda.send(
        new InvokeCommand({
          FunctionName: MASTER_WORKER_FUNCTION,
          InvocationType: 'Event',
          Payload: Buffer.from(JSON.stringify({ videoTextRender: { projectId: id, renderId } })),
        })
      );
    } catch (err) {
      console.error('[api/video-text/render] invoke failed:', err instanceof Error ? err.message : String(err));
      // Release the slot now rather than leaving the project queued until it goes stale.
      await repo.patchRender(id, renderId, { status: 'error', error: START_FAILED }).catch(() => undefined);
      return NextResponse.json({ error: START_FAILED }, { status: 502 });
    }

    return NextResponse.json({ renderId, status: 'queued' }, { status: 202 });
  } catch (err) {
    console.error('[api/video-text/render] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: START_FAILED }, { status: 502 });
  }
}
