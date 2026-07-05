/**
 * /api/admin/generations — log & list Music Lab generations (Phase 1).
 * Admin-gated.
 *
 *   POST { briefId, engine?, chosenStyle?, audioUrl?, settings?, scores?,
 *          verdict, failureReason?, notes? }       → 201 saved generation
 *   GET  ?briefId=…                                → that brief's attempts
 *   GET  ?all=true                                 → the WHOLE feed (paged), for insights
 *   GET  ?limit=…                                  → newest-first feed (capped)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { GenerationRepository } from '@/infrastructure/database/GenerationRepository';
import { BriefRepository } from '@/infrastructure/database/BriefRepository';
import { createGenerationSchema, type Generation } from '@/types/generation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const parsed = createGenerationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid generation payload' },
      { status: 400 }
    );
  }

  try {
    // Referential integrity: never log an attempt against a brief that isn't there.
    const brief = await new BriefRepository().findById(parsed.data.briefId);
    if (!brief) {
      return NextResponse.json({ success: false, error: 'Brief not found' }, { status: 404 });
    }
    const generation = await new GenerationRepository().create(parsed.data);
    return NextResponse.json({ success: true, data: generation }, { status: 201 });
  } catch (err) {
    console.error('[api/admin/generations] save failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to save the generation.' }, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const briefId = request.nextUrl.searchParams.get('briefId');
  const all = request.nextUrl.searchParams.get('all') === 'true';
  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 100;

  try {
    const repo = new GenerationRepository();
    // ?briefId → one brief's attempts; ?all → the full paged feed (insights need
    // the whole dataset, not a 200-row slice); otherwise the capped feed.
    let data: Generation[];
    let truncated = false;
    if (briefId) {
      data = await repo.listByBrief(briefId);
    } else if (all) {
      const res = await repo.listAll();
      data = res.items;
      truncated = res.truncated; // surfaced so the insights panel can flag a capped dataset
    } else {
      data = await repo.list({ limit });
    }
    return NextResponse.json({ success: true, data, truncated });
  } catch (err) {
    console.error('[api/admin/generations] list failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to list generations.' }, { status: 502 });
  }
}
