/**
 * POST /api/admin/lexicon/suggest — AI proposes lexicon entries for review.
 *
 * Admin-gated, explicit action (NOT a render path). Returns candidate words the
 * admin reviews and accepts via the bulk endpoint. Passes existing headwords as
 * `avoid` so suggestions skew toward genuinely new vocabulary. 503 if the AI key
 * isn't configured.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { lexiconSuggestSchema } from '@/types/lexicon';
import { isLexiconAiConfigured, suggestLexiconWords } from '@/services/ai/lexicon-suggest';

export const dynamic = 'force-dynamic';

// Cap how many existing words we feed the model as "avoid" — enough to steer
// it off recent dupes without ballooning the prompt as the lexicon grows.
// (Real dedupe still happens server-side in parseSuggestions + the bulk route,
// so this is a quality hint, not the safety net.)
const MAX_AVOID = 300;

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!isLexiconAiConfigured()) {
    return NextResponse.json(
      { success: false, error: 'AI suggestions not configured (ANTHROPIC_API_KEY missing)' },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = lexiconSuggestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    // Most-recent first so the model avoids the words just added; capped.
    const avoid = (await new LexiconRepository().findAll())
      .map((w) => w.word)
      .slice(-MAX_AVOID);
    const data = await suggestLexiconWords({ ...parsed.data, avoid });
    return NextResponse.json({ success: true, data, total: data.length });
  } catch (err) {
    console.error('[POST /api/admin/lexicon/suggest] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to generate suggestions' }, { status: 502 });
  }
}
