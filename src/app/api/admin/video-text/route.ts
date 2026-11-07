/** GET list / POST create for Video Text projects. Admin-gated. */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VideoTextRepository } from '@/infrastructure/database/VideoTextRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({ name: z.string().trim().min(1).max(120) });

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  try {
    const projects = await new VideoTextRepository().list(50);
    return NextResponse.json({ projects });
  } catch (err) {
    console.error('[api/video-text] list failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not load the projects.' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Give the project a name.' }, { status: 400 });
  try {
    const project = await new VideoTextRepository().create(parsed.data.name);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    console.error('[api/video-text] create failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not create the project.' }, { status: 502 });
  }
}
