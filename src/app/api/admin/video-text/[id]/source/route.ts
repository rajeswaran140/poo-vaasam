/**
 * POST — confirm an uploaded source. The master-worker probes the file
 * (synchronously) for size, fps, length and audio; the route stores the result
 * and fits the existing text blocks to the new length.
 *
 * GET — a 1-hour link to the stored source, so the editor's preview can play
 * it again after a reload (right after an upload it plays the local file).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { VideoTextRepository } from '@/infrastructure/database/VideoTextRepository';
import { awsConfig } from '@/lib/aws-config';
import { expiresAtFrom, floorCentis, isValidProjectId, isVideoTextKeyFor } from '@/lib/video-text/keys';
import { clampToDuration, defaultBlocks } from '@/lib/video-text/timeline';
import type { SourceInfo } from '@/types/videoText';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASTER_WORKER_FUNCTION = process.env.MASTER_WORKER_FUNCTION || 'tamilagaval-master-worker';
const UNREADABLE = 'This video could not be read.';
/** The worker could not open the file (network, signing, its own time limit): nothing wrong with the video. */
const CHECK_AGAIN = 'The video could not be checked just now — press Try again.';
const RENDER_RUNNING = 'A render is running — wait for it to finish before uploading a new video.';

const PREVIEW_URL_TTL_SECONDS = 60 * 60;

const schema = z.object({ key: z.string().min(1).max(1024) });

type ProbeResult =
  | { ok: true; info: { width: number; height: number; fps: number; durationSec: number; hasAudio: boolean } }
  | { ok: false; message?: string; retryable?: boolean };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  try {
    const project = await new VideoTextRepository().get(id);
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const key = project.source?.key;
    if (!project.source || !key || !isVideoTextKeyFor(id, key)) {
      return NextResponse.json({ error: 'No video has been uploaded yet.' }, { status: 404 });
    }
    if (new Date(project.source.expiresAt).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'The uploaded video was deleted after 30 days — upload it again; your timing is kept.' },
        { status: 410 }
      );
    }
    // No download filename: the preview plays it inline.
    const url = await S3Operations.getSignedUrl(key, PREVIEW_URL_TTL_SECONDS);
    return NextResponse.json({ url });
  } catch (err) {
    console.error('[api/video-text/source] presign failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not load the video.' }, { status: 502 });
  }
}

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

    if (probe && probe.ok === false && probe.retryable === true) {
      // 503 = retryable: the page offers Try again, which re-checks this same key.
      return NextResponse.json({ error: CHECK_AGAIN }, { status: 503 });
    }
    if (!probe || probe.ok !== true) {
      const message = probe && probe.ok === false ? probe.message : undefined;
      return NextResponse.json({ error: message || UNREADABLE }, { status: 422 });
    }

    const now = new Date().toISOString();
    // Floored BEFORE the blocks are fitted (R4): the blocks, the stored row and
    // the answer all carry the same length.
    const source: SourceInfo = {
      key,
      ...probe.info,
      durationSec: floorCentis(probe.info.durationSec),
      uploadedAt: now,
      expiresAt: expiresAtFrom(now),
    };

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

    const saved = await repo.setSource(id, source, blocks);
    if (!saved.ok) {
      return saved.reason === 'missing'
        ? NextResponse.json({ error: 'Project not found.' }, { status: 404 })
        : NextResponse.json({ error: RENDER_RUNNING }, { status: 409 });
    }
    return NextResponse.json({ source: { ...source, durationSec: saved.durationSec }, blocks, moved, version: saved.version });
  } catch (err) {
    console.error('[api/video-text/source] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not check the video.' }, { status: 502 });
  }
}
