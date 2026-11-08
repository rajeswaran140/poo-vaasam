/** GET load / PATCH autosave one Video Text project. PATCH is version-checked. */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ENGLISH_FONT_IDS, TAMIL_FONT_IDS, TEXT_COLOR_IDS, TRACK_SIZE_MAX, TRACK_SIZE_MIN } from '@/lib/video-text/fonts';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { VideoTextRepository } from '@/infrastructure/database/VideoTextRepository';
import { isValidProjectId } from '@/lib/video-text/keys';
import { validateBlocks } from '@/lib/video-text/timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const blockSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  track: z.enum(['title', 'lyric', 'credits']),
  text: z.string().max(500),
  startSec: z.number().finite(),
  endSec: z.number().finite(),
});

const placementSchema = z.object({
  v: z.enum(['top', 'middle', 'bottom']),
  h: z.enum(['left', 'center', 'right']),
});

const trackStyleSchema = z.object({
  size: z.number().min(TRACK_SIZE_MIN).max(TRACK_SIZE_MAX).optional(),
  tamilFont: z.enum(TAMIL_FONT_IDS).optional(),
  englishFont: z.enum(ENGLISH_FONT_IDS).optional(),
  color: z.enum(TEXT_COLOR_IDS).optional(),
  box: z.boolean().optional(),
  fade: z.boolean().optional(),
});

const patchSchema = z.object({
  version: z.number().int().min(0),
  edits: z.object({
    name: z.string().trim().min(1).max(120),
    titleText: z.string().max(500),
    creditsText: z.string().max(500),
    lyricsText: z.string().max(20000),
    blocks: z.array(blockSchema).max(400),
    style: z.object({
      sizeScale: z.number().min(0.75).max(1.5),
      lyricPosition: z.enum(['lower', 'middle']),
      titlePlace: placementSchema.optional(),
      creditsPlace: placementSchema.optional(),
      tracks: z
        .object({ title: trackStyleSchema.optional(), lyric: trackStyleSchema.optional(), credits: trackStyleSchema.optional() })
        .optional(),
    }),
  }),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
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
    return NextResponse.json({ project });
  } catch (err) {
    console.error('[api/video-text/:id] load failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not load the project.' }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Those edits could not be saved.' }, { status: 400 });
  const { edits, version } = parsed.data;

  try {
    const repo = new VideoTextRepository();
    // Block timing is checked against the stored video length. Before a video is
    // attached there is nothing to overlap against beyond the blocks themselves.
    const project = await repo.get(id);
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const problem = validateBlocks(edits.blocks, project.source?.durationSec ?? Number.MAX_SAFE_INTEGER);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const saved = await repo.saveEdits(id, edits, version);
    if (!saved.ok) {
      if (saved.reason === 'missing') return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
      return NextResponse.json(
        { error: 'This project was changed in another tab — reload to see the latest.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ version: saved.version });
  } catch (err) {
    console.error('[api/video-text/:id] save failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Could not save the project.' }, { status: 502 });
  }
}
