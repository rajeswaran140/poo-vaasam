/**
 * The one saved logo every Video Text project can use.
 *   GET  → { logo: SavedLogo & { url } | null } (url: a 1-hour link to the image)
 *   POST { contentType } → a presigned S3 POST for a new logo file
 *   PUT  { key, width, height } → the uploaded file becomes THE logo
 * The image is drawn by the browser (preview and the render's PNG), so the
 * worker never reads it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { VideoTextLogoRepository } from '@/infrastructure/database/VideoTextRepository';
import { LOGO_TYPES, MAX_LOGO_BYTES, isLogoKey, logoKey } from '@/lib/video-text/logo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LINK_TTL_SECONDS = 60 * 60;
const UPLOAD_TTL_SECONDS = 15 * 60;
const TYPE_OF_EXT: Record<string, (typeof LOGO_TYPES)[number]> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

const postSchema = z.object({ contentType: z.enum(LOGO_TYPES) });
const putSchema = z.object({
  key: z.string().max(200),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
});

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  try {
    const logo = await new VideoTextLogoRepository().get();
    if (!logo) return NextResponse.json({ logo: null });
    const url = await S3Operations.getSignedUrl(logo.key, LINK_TTL_SECONDS);
    return NextResponse.json({ logo: { ...logo, url } });
  } catch (err) {
    console.error('[api/video-text/logo] load failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not load the logo.' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'The logo must be a PNG, JPG or WebP image.' }, { status: 400 });
  try {
    const key = logoKey(parsed.data.contentType, Date.now(), crypto.randomUUID().replace(/-/g, '').slice(0, 16));
    const { url, fields } = await S3Operations.getSignedUploadPost(key, parsed.data.contentType, MAX_LOGO_BYTES, UPLOAD_TTL_SECONDS, 1);
    return NextResponse.json({ key, url, fields });
  } catch (err) {
    console.error('[api/video-text/logo] presign failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not prepare the logo upload.' }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isLogoKey(parsed.data.key)) {
    return NextResponse.json({ error: 'That logo upload is not valid — try again.' }, { status: 400 });
  }
  const { key, width, height } = parsed.data;
  try {
    const size = await S3Operations.getContentLength(key);
    if (!size || size > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: 'The logo did not finish uploading — try again.' }, { status: 400 });
    }
    const logo = { key, contentType: TYPE_OF_EXT[key.split('.').pop()!], width, height, uploadedAt: new Date().toISOString() };
    await new VideoTextLogoRepository().set(logo);
    const url = await S3Operations.getSignedUrl(key, LINK_TTL_SECONDS);
    return NextResponse.json({ logo: { ...logo, url } });
  } catch (err) {
    console.error('[api/video-text/logo] save failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not save the logo.' }, { status: 502 });
  }
}
