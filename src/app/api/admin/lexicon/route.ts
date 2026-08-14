/**
 * GET  /api/admin/lexicon  — list the lexicon (optional filters).
 * POST /api/admin/lexicon  — create a word (409 if the headword already exists).
 *
 * Admin-gated. force-dynamic — runtime DynamoDB read/write via APP_AWS_* creds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { lexiconWordInputSchema, normalizeWord } from '@/types/lexicon';
import { searchLexicon, lexiconCounts } from '@/lib/lexicon-search';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const sp = request.nextUrl.searchParams;
  const filters = {
    register: sp.get('register') || undefined,
    usage: sp.get('usage') || undefined,
    theme: sp.get('theme') || undefined,
    wordType: sp.get('wordType') || undefined,
    lexicalStatus: sp.get('lexicalStatus') || undefined,
    confidence: sp.get('confidence') || undefined,
    mood: sp.get('mood') || undefined,
    includeArchived: sp.get('archived') === 'true',
    needsReview: sp.get('needsReview') === 'true',
  };

  try {
    const all = await new LexiconRepository().findAll();
    // Search runs over the WHOLE lexicon so relation expansion can see entries
    // the filters exclude, then the filters are applied inside searchLexicon.
    const data = searchLexicon(all, sp.get('q') || '', filters);
    // Counts describe the whole lexicon, not the current page or filter — they
    // are the header strip ("1,047 words · 96 sangam"), which would be useless
    // if it changed every time a filter narrowed the table.
    return NextResponse.json({ success: true, data, total: data.length, counts: lexiconCounts(all) });
  } catch (err) {
    console.error('[GET /api/admin/lexicon] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to load lexicon' }, { status: 500 });
  }
}

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
  const parsed = lexiconWordInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid word', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const repo = new LexiconRepository();
    const existing = await repo.findByWord(normalizeWord(parsed.data.word));
    if (existing) {
      return NextResponse.json({ success: false, error: 'Word already exists', id: existing.id }, { status: 409 });
    }
    const created = await repo.create(parsed.data);
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/admin/lexicon] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to create word' }, { status: 500 });
  }
}
