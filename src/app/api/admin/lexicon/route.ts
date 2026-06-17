/**
 * GET  /api/admin/lexicon  — list the lexicon (optional filters).
 * POST /api/admin/lexicon  — create a word (409 if the headword already exists).
 *
 * Admin-gated. force-dynamic — runtime DynamoDB read/write via APP_AWS_* creds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { lexiconWordInputSchema, normalizeWord } from '@/types/lexicon';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const sp = request.nextUrl.searchParams;
  const register = sp.get('register') || undefined;
  const usage = sp.get('usage') || undefined;
  const theme = sp.get('theme') || undefined;
  const q = (sp.get('q') || '').normalize('NFC').trim().toLowerCase();
  const includeArchived = sp.get('archived') === 'true';

  try {
    const all = await new LexiconRepository().findAll();
    const data = all.filter((w) => {
      if (!includeArchived && w.archived) return false;
      if (register && w.register !== register) return false;
      if (usage && w.usage !== usage) return false;
      if (theme && !w.themes.includes(theme)) return false;
      if (q && !(`${w.word} ${w.romanization ?? ''} ${w.gloss}`.toLowerCase().includes(q))) return false;
      return true;
    });
    return NextResponse.json({ success: true, data, total: data.length });
  } catch (err) {
    console.error('[GET /api/admin/lexicon] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to load lexicon' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
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
