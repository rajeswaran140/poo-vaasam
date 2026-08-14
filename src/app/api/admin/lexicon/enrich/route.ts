/**
 * POST /api/admin/lexicon/enrich — AI proposes the metadata a bare entry lacks.
 *
 * The follow-up to a bulk paste: 50 headwords arrive sharing one gloss and
 * nothing else, and this offers Tamil meanings, registers, themes, relations
 * and example phrases for them.
 *
 * ⚠️ RETURNS PROPOSALS, WRITES NOTHING. Raj's instruction is that AI-generated
 * enrichment "must be treated as suggestions and remain editable", so this
 * route deliberately has no side effect: the admin reviews each field and saves
 * through the ordinary PUT. Wiring it straight into the repository would turn a
 * model's guess into stored fact, which is the failure mode the whole
 * lexical-status/confidence design exists to prevent.
 *
 * Admin-gated, explicit action, never a render path. 503 when AI is unconfigured.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { isLexiconAiConfigured } from '@/services/ai/lexicon-suggest';
import { enrichWords, MAX_ENRICH_BATCH } from '@/services/ai/lexicon-enrich';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** Enrich these specific entries. */
  ids: z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_ENRICH_BATCH).optional(),
  /** Or: enrich the first N entries that are missing metadata. */
  missingOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(MAX_ENRICH_BATCH).default(MAX_ENRICH_BATCH),
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
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }

  try {
    const all = await new LexiconRepository().findAll();
    const { ids, missingOnly, limit } = parsed.data;

    const selected = ids
      ? all.filter((w) => ids.includes(w.id))
      : all
          .filter((w) => !w.archived)
          .filter((w) => (missingOnly ? !w.tamilMeaning || !w.themes.length || !w.wordType : true))
          .slice(0, limit);

    if (!selected.length) {
      return NextResponse.json({ success: true, data: [], total: 0 });
    }

    const data = await enrichWords(selected.map((w) => ({ word: w.word, gloss: w.gloss })));
    // Pair each proposal back to its entry id so the UI can offer "apply" per
    // field without re-matching on the headword.
    const byWord = new Map(selected.map((w) => [w.word.normalize('NFC').trim(), w.id]));
    const withIds = data.map((d) => ({ ...d, id: byWord.get(d.word.normalize('NFC').trim()) }));

    return NextResponse.json({ success: true, data: withIds, total: withIds.length });
  } catch (err) {
    console.error('[POST /api/admin/lexicon/enrich] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to enrich words' }, { status: 502 });
  }
}
