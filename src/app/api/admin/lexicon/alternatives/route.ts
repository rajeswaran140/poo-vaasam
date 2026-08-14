/**
 * POST /api/admin/lexicon/alternatives — near-synonyms WITH their nuances.
 *
 * Answers "what else could I put here?" for one word. The nuance is the whole
 * point: அழகு / எழில் / வனப்பு / பொலிவு / நளினம் all gloss as "beauty" and are
 * not the same word, so a bare list would mislead. The service prompt requires
 * a difference for every candidate and marks whether it can actually substitute.
 *
 * Read-only: proposes vocabulary, stores nothing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { isLexiconAiConfigured } from '@/services/ai/lexicon-suggest';
import { findAlternatives } from '@/services/ai/lexicon-enrich';
import { matchKey } from '@/lib/tamil-normalize';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  word: z.string().trim().min(1).max(60),
  gloss: z.string().trim().max(400).optional(),
  count: z.number().int().min(1).max(12).default(6),
});

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    // Defense-in-depth CSRF: reject cookie-only auth on this mutation
    // (matches the pattern on the other admin mutation routes).
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isLexiconAiConfigured()) {
    return NextResponse.json({ success: false, error: 'AI is not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }

  try {
    const { word, gloss, count } = parsed.data;
    const alternatives = await findAlternatives(word, gloss, count);

    // Mark which candidates the poet already owns, so the UI can offer "add"
    // only for the genuinely new ones and show the rest as already his.
    const known = new Set((await new LexiconRepository().findAll()).map((w) => w.normalizedWord || matchKey(w.word)));
    const data = alternatives.map((a) => ({ ...a, known: known.has(matchKey(a.word)) }));

    return NextResponse.json({ success: true, data, total: data.length });
  } catch (err) {
    console.error('[POST /api/admin/lexicon/alternatives] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to find alternatives' }, { status: 502 });
  }
}
