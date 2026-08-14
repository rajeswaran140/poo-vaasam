/**
 * POST /api/admin/lexicon/lyric-context — read a lyric line, suggest vocabulary.
 *
 * Paste "மாலை வானம் சிவக்குதே" and get back the concepts in it (மாலை, வானம்,
 * நிறம், இயற்கை) plus related Tamil imagery to explore — அந்தி, செவ்வானம்,
 * செங்கதிர், பொன்மாலை, அந்திச்சுடர்.
 *
 * ⚠️ IT DOES NOT REWRITE THE LINE. Raj's instruction is that the tool suggests
 * "WITHOUT rewriting the lyric unless explicitly requested", and the whole
 * lexicon exists to help him find words rather than to replace him
 * ([[feedback_tamilagaval_ai_augments_craft]]). The service prompt forbids a
 * rewrite and the parser drops any "suggestion" long enough to be one.
 *
 * Read-only: stores nothing, and the line is never persisted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { isLexiconAiConfigured } from '@/services/ai/lexicon-suggest';
import { analyzeLyricLine } from '@/services/ai/lexicon-enrich';
import { matchKey } from '@/lib/tamil-normalize';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  // One or two lines, not a verse — this is a lookup tool, not a draft surface.
  line: z.string().trim().min(1).max(300),
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
    const result = await analyzeLyricLine(parsed.data.line);

    const known = new Set((await new LexiconRepository().findAll()).map((w) => w.normalizedWord || matchKey(w.word)));
    const suggestions = result.suggestions.map((s) => ({ ...s, known: known.has(matchKey(s.word)) }));

    return NextResponse.json({ success: true, concepts: result.concepts, suggestions });
  } catch (err) {
    console.error('[POST /api/admin/lexicon/lyric-context] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to read the line' }, { status: 502 });
  }
}
