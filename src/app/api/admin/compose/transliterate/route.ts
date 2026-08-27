/**
 * GET /api/admin/compose/transliterate?text=<word>&lang=<code> — admin-gated
 * proxy for Google Input Tools transliteration.
 *
 * WHY THIS EXISTS. react-transliterate posts to
 * https://inputtools.google.com/request from the browser. The endpoint returns
 * the right suggestions but WITHOUT `Access-Control-Allow-Origin`, so every
 * modern browser rejects the response as a CORS violation. The CSP fix
 * (2026-08-27) allowed the fetch to leave the browser; this route makes the
 * response actually reach it, by fetching server-side and returning the JSON.
 *
 * Auth: admin (GET → no Bearer requirement, matches other read routes).
 * Cost: none — Google's inputtools is a public endpoint. No rate limit here
 * because the client fires one call per typed word already and the SSR
 * Lambda's own concurrency + Google's rate-limit are the practical ceilings.
 *
 * Returns the upstream JSON verbatim so react-transliterate's parser (which
 * expects `[status, [[word, [candidates, …], …]]]`) works unchanged. On any
 * upstream failure, returns `["ERROR"]` so the client falls back to the
 * user's original input.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Basic input sanitisation. Google inputtools accepts short words + a language
// code — anything longer than 100 chars or with weird control chars is a
// mistake or an attempt to smuggle something through us to Google. Reject
// early so we never make the upstream call with bad input.
const MAX_TEXT_LEN = 100;
const LANG_RE = /^[a-z]{2,4}$/i;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const sp = new URL(request.url).searchParams;
  const text = sp.get('text') ?? '';
  const lang = sp.get('lang') ?? 'ta';
  const num = Number(sp.get('num') ?? 5);

  if (!text || text.length > MAX_TEXT_LEN || /[\x00-\x1F]/.test(text)) {
    return NextResponse.json(['ERROR'], { status: 400 });
  }
  if (!LANG_RE.test(lang)) {
    return NextResponse.json(['ERROR'], { status: 400 });
  }
  const safeNum = Number.isFinite(num) && num > 0 && num <= 20 ? num : 5;

  const upstream =
    `https://inputtools.google.com/request` +
    `?text=${encodeURIComponent(text)}` +
    `&itc=${encodeURIComponent(lang)}-t-i0-und` +
    `&num=${safeNum}` +
    `&cp=0&cs=1&ie=utf-8&oe=utf-8&app=demopage`;

  try {
    const res = await fetch(upstream, {
      // Google's endpoint has no CORS, so the browser can't reach it — but a
      // server-side fetch has no such restriction. No cookies.
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      return NextResponse.json(['ERROR'], { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      // Cache per-word for a few minutes: transliteration is deterministic and
      // typing "kaathal" many times shouldn't hit Google every keystroke.
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    });
  } catch (err) {
    console.warn(
      '[api/admin/compose/transliterate] upstream fetch failed:',
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(['ERROR'], { status: 502 });
  }
}
