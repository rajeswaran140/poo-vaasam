/**
 * POST /api/admin/visual-story/[vsId]/shots/[shotKey]/upload — the admin's own
 * picture for a shot (e.g. a thumbnail). It becomes a free STILL candidate, so
 * it can be chosen, or pinned with "Use as first frame" for the next clip.
 * Or the admin's own MP4 clip (e.g. made in Grok outside the studio): a free
 * HERO candidate (providerId 'upload'), chosen for the shot, never billed.
 *   { op: 'presign', contentType, size? } → { uploadUrl, fields, key }
 *   { op: 'confirm', key }                → 201 { candidate } (200 if already added)
 *
 * Same presigned-POST pattern as the character-reference upload: S3 enforces
 * the size window and the pinned type, the key (and so the candidate id) is
 * minted here, and confirm only accepts a picture key of THIS story whose id
 * is not already another candidate, after HeadObject shows the file arrived.
 * JPEG and PNG only: the types Grok takes as a first frame. No money moves.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { isVsId, newId } from '@/types/visualStory';
import type { Candidate } from '@/types/visualStory';
import {
  MAX_CLIP_BYTES,
  MAX_REF_BYTES,
  candidateKey,
  clipExtensionFor,
  parseUploadedKey,
  pictureExtensionFor,
} from '@/lib/visual-story-storage';
import { chooseIfNone, fail, limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_URL_TTL_SECONDS = 60 * 60;
const SHOT_KEY = /^(\d{3})-(\d{3})$/;

type Ctx = { params: Promise<{ vsId: string; shotKey: string }> };

const bodySchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('presign'),
    contentType: z.string().min(1).max(127),
    size: z.number().int().positive().optional(),
  }),
  z.object({ op: z.literal('confirm'), key: z.string().max(1024) }),
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

  const { vsId, shotKey } = await params;
  const m = SHOT_KEY.exec(shotKey);
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);
  if (!m) return fail('That shot no longer exists.', 404);
  const sceneOrder = Number(m[1]);
  const shotOrder = Number(m[2]);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid request body', 400);
  const input = parsed.data;

  try {
    const repo = new VisualStoryRepository();
    const tree = await repo.loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);
    if (!tree.shots.some((s) => s.sceneOrder === sceneOrder && s.shotOrder === shotOrder)) {
      return fail('That shot no longer exists.', 404);
    }

    if (input.op === 'presign') {
      const ext = pictureExtensionFor(input.contentType) ?? clipExtensionFor(input.contentType);
      if (!ext) return fail('Upload a JPEG or PNG picture, or an MP4 clip.', 400);
      const limit = ext === 'mp4' ? MAX_CLIP_BYTES : MAX_REF_BYTES;
      if (typeof input.size === 'number' && input.size > limit) {
        return fail(`File too large — the limit is ${limit / (1024 * 1024)}MB.`, 400);
      }
      const key = candidateKey(vsId, newId('cd'), ext);
      try {
        const { url, fields } = await S3Operations.getSignedUploadPost(
          key,
          input.contentType,
          limit,
          UPLOAD_URL_TTL_SECONDS,
          1
        );
        return NextResponse.json({ success: true, uploadUrl: url, fields, key });
      } catch (err) {
        console.error('[visual-story/picture] presign failed:', err instanceof Error ? err.name : 'error');
        return fail('Could not create the upload URL.', 502);
      }
    }

    // confirm
    const pic = parseUploadedKey(input.key, vsId);
    if (!pic) return fail('That file does not belong to this story.', 400);
    const isClip = pic.ext === 'mp4';
    const limit = isClip ? MAX_CLIP_BYTES : MAX_REF_BYTES;
    const existing = tree.candidates.find((c) => c.candId === pic.candId);
    if (existing) {
      const same =
        existing.s3Key === input.key && existing.sceneOrder === sceneOrder && existing.shotOrder === shotOrder;
      if (same) return NextResponse.json({ success: true, data: { candidate: existing } });
      return fail('That picture is already in use. Upload it again.', 409);
    }

    let size: number | null;
    try {
      size = await S3Operations.getContentLength(input.key);
    } catch (err) {
      console.error('[visual-story/picture] head failed:', err instanceof Error ? err.name : 'error');
      return fail('Could not check the upload.', 502);
    }
    if (size === null) return fail('The upload did not arrive. Try again.', 400);
    if (size < 1 || size > limit) return fail('That file is empty or too large.', 400);

    const candidate: Candidate = {
      candId: pic.candId,
      sceneOrder,
      shotOrder,
      jobId: null,
      providerId: 'upload',
      providerTaskId: null,
      mode: isClip ? 'HERO' : 'STILL',
      s3Key: input.key,
      costUsd: 0,
      createdAt: new Date().toISOString(),
    };
    await repo.putCandidate(vsId, candidate);
    await chooseIfNone(repo, vsId, sceneOrder, shotOrder, pic.candId);
    return NextResponse.json({ success: true, data: { candidate } }, { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}
