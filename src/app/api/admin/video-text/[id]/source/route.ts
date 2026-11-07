/**
 * POST — confirm an uploaded source. The master-worker probes the file
 * (synchronously) for size, fps, length and audio; the route stores the result
 * and fits the existing text blocks to the new length.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VideoTextRepository } from '@/infrastructure/database/VideoTextRepository';
import { awsConfig } from '@/lib/aws-config';
import { expiresAtFrom, isValidProjectId, isVideoTextKeyFor } from '@/lib/video-text/keys';
import { clampToDuration, defaultBlocks } from '@/lib/video-text/timeline';
import type { SourceInfo } from '@/types/videoText';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';
const UNREADABLE = 'This video could not be read.';

const schema = z.object({ key: z.string().min(1).max(1024) });

type ProbeResult =
  | { ok: true; info: { width: number; height: number; fps: number; durationSec: number; hasAudio: boolean } }
  | { ok: false; message?: string };

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
  if (!parsed.success || !isVideoTextKeyFor(id, parsed.data.key)) {
    return NextResponse.json({ error: 'That file does not belong to this project.' }, { status: 400 });
  }
  const { key } = parsed.data;

  try {
    const repo = new VideoTextRepository();
    const project = await repo.get(id);
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

    let probe: ProbeResult;
    try {
      const lambda = new LambdaClient({
        region: awsConfig.region,
        ...(awsConfig.credentials ? { credentials: awsConfig.credentials } : {}),
      });
      const res = await lambda.send(
        new InvokeCommand({
          FunctionName: MASTER_WORKER_FUNCTION,
          InvocationType: 'RequestResponse',
          Payload: Buffer.from(JSON.stringify({ videoTextProbe: { key } })),
        })
      );
      if (res.FunctionError) {
        let message: string | undefined;
        try {
          const body = JSON.parse(Buffer.from(res.Payload ?? []).toString());
          message = typeof body?.message === 'string' ? body.message : undefined;
        } catch {
          /* unreadable error body */
        }
        return NextResponse.json({ error: message || UNREADABLE }, { status: 422 });
      }
      probe = JSON.parse(Buffer.from(res.Payload ?? []).toString()) as ProbeResult;
    } catch (err) {
      const name = (err as { name?: string })?.name ?? '';
      if (name === 'TooManyRequestsException' || name.includes('TooManyRequests')) {
        return NextResponse.json({ error: 'The video worker is busy — try again in a minute.' }, { status: 503 });
      }
      throw err;
    }

    if (!probe || probe.ok !== true) {
      const message = probe && probe.ok === false ? probe.message : undefined;
      return NextResponse.json({ error: message || UNREADABLE }, { status: 422 });
    }

    const now = new Date().toISOString();
    const source: SourceInfo = { key, ...probe.info, uploadedAt: now, expiresAt: expiresAtFrom(now) };

    // Re-fit existing text to the new length; a fresh project gets default timing.
    let blocks = project.blocks;
    let moved = 0;
    if (blocks.length > 0) {
      ({ blocks, moved } = clampToDuration(blocks, source.durationSec));
    } else {
      blocks = defaultBlocks({
        titleText: project.titleText,
        creditsText: project.creditsText,
        lyricsText: project.lyricsText,
        durationSec: source.durationSec,
      });
    }

    const { version } = await repo.setSource(id, source, blocks);
    return NextResponse.json({ source, blocks, moved, version });
  } catch (err) {
    console.error('[api/video-text/source] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not check the video.' }, { status: 502 });
  }
}
