/**
 * GET /api/admin/transliterate?text=amma&lang=ta&n=9
 *
 * Same-origin proxy to Google Input Tools. The browser can't call Google
 * directly (no CORS header), so the transliteration field hits this instead.
 * Admin-gated (it's an authoring aid), force-dynamic, with a small in-memory
 * cache so repeated keystrokes for the same token don't re-hit Google.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { inputToolsUrl, parseInputToolsCandidates } from '@/lib/transliterate';

export const dynamic = 'force-dynamic';

// Tiny LRU-ish cache (token → candidates) for the warm Lambda. Bounded so it
// can't grow unbounded across a long-lived instance.
const cache = new Map<string, string[]>();
const CACHE_MAX = 2000;

function cached(key: string): string[] | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // refresh recency
    cache.set(key, hit);
  }
  return hit;
}
function remember(key: string, value: string[]): void {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const sp = request.nextUrl.searchParams;
  const text = (sp.get('text') || '').trim();
  const lang = (sp.get('lang') || 'ta').trim();
  const n = Math.max(1, Math.min(20, Number(sp.get('n')) || 9));

  // Only latin input is transliterable; bail cheaply otherwise.
  if (!text || !/^[A-Za-z]+$/.test(text)) {
    return NextResponse.json({ success: true, candidates: [] });
  }

  const key = `${lang}:${n}:${text.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return NextResponse.json({ success: true, candidates: hit });

  try {
    const res = await fetch(inputToolsUrl(text, lang, n), {
      headers: { 'User-Agent': 'tamilagaval/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ success: true, candidates: [] });
    }
    const candidates = parseInputToolsCandidates(await res.json());
    remember(key, candidates);
    return NextResponse.json({ success: true, candidates });
  } catch (err) {
    console.error('[transliterate] upstream failed', err);
    // Never break typing — degrade to "no suggestions".
    return NextResponse.json({ success: true, candidates: [] });
  }
}
