/**
 * POST /api/admin/lexicon/bulk-update — apply one change to many entries.
 *
 * The tool for correcting groups of words: select rows, set a register, add a
 * theme. Without it, fixing the ~1,046 entries that carry a defaulted `sangam`
 * register means opening them one at a time.
 *
 * ⚠️ PARTIAL SUCCESS IS REPORTED, NOT SWALLOWED. Each entry is written
 * individually (there is no transactional multi-item update here), so a failure
 * halfway through leaves some applied and some not. The response says exactly
 * which ids failed — reporting "success" after updating 140 of 200 would send
 * the poet away believing work was done that was not.
 *
 * Admin-gated, force-dynamic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { lexiconBulkUpdateSchema } from '@/types/lexicon';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    // Defense-in-depth CSRF: reject cookie-only auth on this mutation
    // (matches the pattern on the other admin mutation routes).
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const parsed = lexiconBulkUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid bulk update', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ids, addThemes, removeThemes, ...fields } = parsed.data;
  const repo = new LexiconRepository();
  const failed: string[] = [];
  let updated = 0;

  for (const id of ids) {
    try {
      // Themes are read-modify-write per entry: "add nature to these 40 words"
      // must preserve whatever themes each already carries.
      let themes: string[] | undefined;
      if (addThemes?.length || removeThemes?.length) {
        const existing = await repo.findById(id);
        if (!existing) {
          failed.push(id);
          continue;
        }
        const next = new Set(existing.themes);
        for (const t of addThemes ?? []) next.add(t);
        for (const t of removeThemes ?? []) next.delete(t);
        themes = [...next];
      }

      await repo.update(id, { ...fields, ...(themes ? { themes } : {}) });
      updated += 1;
    } catch (err) {
      console.error('[POST /api/admin/lexicon/bulk-update] entry failed', id, err);
      failed.push(id);
    }
  }

  return NextResponse.json({
    success: failed.length === 0,
    updated,
    failed,
    requested: ids.length,
  });
}
