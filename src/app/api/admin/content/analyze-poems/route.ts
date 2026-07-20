/**
 * POST /api/admin/content/analyze-poems
 *
 * Precompute + store the emotion analysis on poem Content rows so the reader
 * never spends an LLM call at runtime (see PoemReader + /api/ai/analyze-poem).
 *
 * Body (all optional):
 *   { id?: string }        → analyze that one poem
 *   { limit?: number=25 }  → backfill up to N published poems missing analysis
 *   { force?: boolean }    → re-analyze even poems that already have one
 *
 * Admin-gated. Runs the OpenAI call server-side (where the key + DynamoDB write
 * creds live), then persists via a normal Content save. A rebuild is what bakes
 * the stored analysis into the statically-generated poem pages.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import type { Content } from '@/domain/entities/Content';
import { ContentType, ContentStatus } from '@/types/content';
import { analyzePoemEmotion, isPoemAnalysisConfigured } from '@/services/ai/poem-emotion';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({
  id: z.string().regex(/^cnt_[a-z0-9_]+$/i).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  force: z.boolean().optional(),
});

// Poems missing an analysis are scanned in one bounded page; keep the batch
// small so a run stays well within the request budget and cost stays trivial.
const SCAN_PAGE = 100;

async function analyzeAndStore(repo: ContentRepository, content: Content) {
  const analysis = await analyzePoemEmotion({
    title: content.title,
    body: content.body,
    author: content.author,
  });
  content.setEmotionAnalysis(analysis);
  await repo.save(content);
  return analysis;
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isPoemAnalysisConfigured()) {
    return NextResponse.json(
      { success: false, error: 'OpenAI API key not configured' },
      { status: 503 }
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { id, limit = 25, force = false } = parsed.data;
  const repo = new ContentRepository();

  // Single, targeted analysis.
  if (id) {
    const content = await repo.findById(id);
    if (!content) {
      return NextResponse.json({ success: false, error: 'Content not found' }, { status: 404 });
    }
    try {
      const analysis = await analyzeAndStore(repo, content);
      return NextResponse.json({ success: true, analyzed: [{ id, emotion: analysis.emotion }], failed: [] });
    } catch (err) {
      logger.error('[admin/analyze-poems] single analysis failed', err);
      return NextResponse.json({ success: false, error: 'Analysis failed', id }, { status: 502 });
    }
  }

  // Backfill: published poems missing an analysis (or all, when force).
  const page = await repo.findByType(ContentType.POEMS, {
    status: ContentStatus.PUBLISHED,
    limit: SCAN_PAGE,
  });
  const missing = page.items.filter((c) => !c.emotionAnalysis);
  const candidates = (force ? page.items : missing).slice(0, limit);

  const analyzed: Array<{ id: string; emotion: string }> = [];
  const failed: Array<{ id: string }> = [];
  for (const content of candidates) {
    try {
      const analysis = await analyzeAndStore(repo, content);
      analyzed.push({ id: content.id, emotion: analysis.emotion });
    } catch (err) {
      logger.error(`[admin/analyze-poems] failed for ${content.id}`, err);
      failed.push({ id: content.id });
    }
  }

  return NextResponse.json({
    success: true,
    scanned: page.items.length,
    candidates: candidates.length,
    analyzed,
    failed,
    // How many published poems still lack an analysis after this run.
    remaining: Math.max(0, missing.length - analyzed.length),
  });
}
