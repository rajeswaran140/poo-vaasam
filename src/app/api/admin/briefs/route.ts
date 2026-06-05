/**
 * /api/admin/briefs — save & list production briefs (Music Director, Phase 2).
 * Admin-gated.
 *
 *   POST  { lyrics, analysis, contentId?, decision? }  → saves, returns the brief
 *   GET   ?limit=50                                     → newest-first list
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { BriefRepository } from '@/infrastructure/database/BriefRepository';
import { composerAnalysisSchema } from '@/services/ai/composerSchema';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  lyrics: z.string().min(1, 'Lyrics required').max(8000),
  // The structured brief is validated against the FULL composer schema — this
  // record is the durable "source of truth", so we refuse to persist a
  // malformed / partial / unknown-shaped analysis. Unknown keys are stripped.
  analysis: composerAnalysisSchema,
  contentId: z.string().min(1).optional(),
  decision: z
    .object({ chosenSunoStyle: z.string().optional(), notes: z.string().optional() })
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid brief payload' }, { status: 400 });
  }

  try {
    const repo = new BriefRepository();
    // `analysis` is fully validated against the composer schema above, so it
    // already matches the stored type — no cast needed.
    const brief = await repo.save({
      lyrics: parsed.data.lyrics,
      analysis: parsed.data.analysis,
      contentId: parsed.data.contentId,
      decision: parsed.data.decision,
    });
    return NextResponse.json({ success: true, data: brief }, { status: 201 });
  } catch (err) {
    console.error('[api/admin/briefs] save failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to save the brief.' }, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

  try {
    const repo = new BriefRepository();
    const items = await repo.list({ limit });
    return NextResponse.json({ success: true, data: items });
  } catch (err) {
    console.error('[api/admin/briefs] list failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to list briefs.' }, { status: 502 });
  }
}
