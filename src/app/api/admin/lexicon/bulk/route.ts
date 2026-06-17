/**
 * POST /api/admin/lexicon/bulk — accept a batch of curated/suggested words.
 *
 * Admin-gated. Dedupes against the existing lexicon AND within the batch (by NFC
 * headword), creating only genuinely new words. Returns counts so the UI can
 * report "added N, skipped M (already known)".
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { lexiconBulkSchema, normalizeWord } from '@/types/lexicon';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const parsed = lexiconBulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid batch', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const repo = new LexiconRepository();
    const existing = new Set((await repo.findAll()).map((w) => normalizeWord(w.word)));
    const batchSeen = new Set<string>();
    let added = 0;
    let skipped = 0;

    for (const input of parsed.data.words) {
      const key = normalizeWord(input.word);
      if (existing.has(key) || batchSeen.has(key)) {
        skipped++;
        continue;
      }
      batchSeen.add(key);
      await repo.create(input);
      added++;
    }
    return NextResponse.json({ success: true, added, skipped });
  } catch (err) {
    console.error('[POST /api/admin/lexicon/bulk] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to save words' }, { status: 500 });
  }
}
