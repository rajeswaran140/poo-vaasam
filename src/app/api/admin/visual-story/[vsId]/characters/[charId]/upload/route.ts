/**
 * POST /api/admin/visual-story/[vsId]/characters/[charId]/upload
 *   { op: 'presign', contentType, size? } → { uploadUrl, fields, key }
 *   { op: 'confirm', key }                → appends the key to the character
 *   { op: 'remove', key }                 → drops the key, then best-effort deletes the object
 *
 * Same presigned-POST pattern as /api/admin/mastering/upload, into the same
 * private mastering bucket: S3 itself enforces the size window
 * (content-length-range 1..MAX_REF_BYTES) and the pinned content type. The key
 * is built here from validated ids and never taken from the client; confirm
 * only accepts a key under THIS character's own refs prefix, and only after
 * HeadObject shows the object exists with a size inside the window.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { isVsId, isCharId } from '@/types/visualStory';
import {
  ACCEPTED_REF_TYPES,
  MAX_REF_BYTES,
  MAX_REFS_PER_CHARACTER,
  refKey,
  refExtensionFor,
  isRefKeyFor,
} from '@/lib/visual-story-storage';
import { fail, limitMutation, mapError } from '@/lib/visual-story-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_URL_TTL_SECONDS = 60 * 60;

type Ctx = { params: Promise<{ vsId: string; charId: string }> };

const bodySchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('presign'),
    contentType: z.string().min(1).max(127),
    size: z.number().int().positive().optional(),
  }),
  z.object({ op: z.literal('confirm'), key: z.string().max(1024) }),
  z.object({ op: z.literal('remove'), key: z.string().max(1024) }),
]);

const FULL = `A character can have at most ${MAX_REFS_PER_CHARACTER} reference images. Remove one first.`;

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
  const { vsId, charId } = await params;
  if (!isVsId(vsId)) return fail('That story no longer exists.', 404);
  if (!isCharId(charId)) return fail('That character no longer exists.', 404);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid request body', 400);
  const input = parsed.data;

  try {
    const repo = new VisualStoryRepository();
    const tree = await repo.loadTree(vsId);
    if (!tree) return fail('That story no longer exists.', 404);
    const character = tree.characters.find((c) => c.charId === charId);
    if (!character) return fail('That character no longer exists.', 404);
    const refs = character.refImageKeys ?? [];

    if (input.op === 'presign') {
      const ext = (ACCEPTED_REF_TYPES as readonly string[]).includes(input.contentType)
        ? refExtensionFor(input.contentType)
        : null;
      if (!ext) return fail('Upload a JPEG, PNG or WebP image.', 400);
      if (typeof input.size === 'number' && input.size > MAX_REF_BYTES) {
        return fail(`File too large — the limit is ${MAX_REF_BYTES / (1024 * 1024)}MB.`, 400);
      }
      if (refs.length >= MAX_REFS_PER_CHARACTER) return fail(FULL, 400);

      const key = refKey(vsId, charId, ext);
      try {
        const { url, fields } = await S3Operations.getSignedUploadPost(
          key,
          input.contentType,
          MAX_REF_BYTES,
          UPLOAD_URL_TTL_SECONDS,
          1
        );
        return NextResponse.json({ success: true, uploadUrl: url, fields, key });
      } catch (err) {
        console.error('[visual-story/upload] presign failed:', err instanceof Error ? err.name : 'error');
        return fail('Could not create the upload URL.', 502);
      }
    }

    if (input.op === 'remove') {
      // Same prefix rule as confirm: nothing outside this character's own refs
      // can reach the repository or S3.
      if (!isRefKeyFor(input.key, vsId, charId)) return fail('That file does not belong to this character.', 400);
      if (!refs.includes(input.key)) return fail('That image is not on this character.', 404);
      await repo.removeCharacterRef(vsId, charId, input.key);
      try {
        await S3Operations.deleteFile(input.key);
      } catch (err) {
        // The reference is already detached; an orphan in a private prefix is harmless.
        console.error('[visual-story/upload] object delete failed:', err instanceof Error ? err.name : 'error');
      }
      return NextResponse.json({
        success: true,
        data: { character: { ...character, refImageKeys: refs.filter((k) => k !== input.key) } },
      });
    }

    // confirm
    if (!isRefKeyFor(input.key, vsId, charId)) return fail('That file does not belong to this character.', 400);
    if (refs.includes(input.key)) return NextResponse.json({ success: true, data: { character } });
    if (refs.length >= MAX_REFS_PER_CHARACTER) return fail(FULL, 400);

    let size: number | null;
    try {
      size = await S3Operations.getContentLength(input.key);
    } catch (err) {
      console.error('[visual-story/upload] head failed:', err instanceof Error ? err.name : 'error');
      return fail('Could not check the upload.', 502);
    }
    if (size === null) return fail('The upload did not arrive. Try again.', 400);
    if (size < 1 || size > MAX_REF_BYTES) return fail('That file is empty or too large.', 400);

    await repo.addCharacterRef(vsId, charId, input.key);
    return NextResponse.json({
      success: true,
      data: { character: { ...character, refImageKeys: [...refs, input.key] } },
    });
  } catch (err) {
    return mapError(err);
  }
}
