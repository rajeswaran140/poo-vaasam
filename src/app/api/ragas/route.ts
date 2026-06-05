/**
 * GET /api/ragas — the Carnatic & Hindustani raga catalog (also the melodic
 * system of Sri Lankan Carnatic / Tamil classical music).
 *
 * Public reference data (the same catalog the AI Composer grounds on). Static,
 * non-sensitive, and cacheable.
 *
 * Query params (all optional):
 *   tradition=Carnatic|Hindustani   mood=<e.g. devotional>   q=<free text>
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRagas, type RagaTradition } from '@/data/ragas';

export const dynamic = 'force-static';

export function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const data = getRagas({
    tradition: (sp.get('tradition') as RagaTradition) || undefined,
    mood: sp.get('mood') || undefined,
    q: sp.get('q') || undefined,
  });

  return NextResponse.json(
    { success: true, data, total: data.length },
    { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } }
  );
}
