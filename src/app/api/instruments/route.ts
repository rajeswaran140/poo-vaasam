/**
 * GET /api/instruments — the Indian & Sri Lankan musical-instrument catalog.
 *
 * Public reference data (the same catalog the AI Composer grounds on). Static,
 * non-sensitive, and cacheable.
 *
 * Query params (all optional):
 *   region=India|Sri Lanka|Both   category=string|wind|percussion|drone|keyboard
 *   tradition=<e.g. Carnatic>     mood=<e.g. devotional>     q=<free text>
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getInstruments,
  type InstrumentRegion,
  type InstrumentCategory,
} from '@/data/instruments';

// Must be dynamic: the handler reads query params (region/category/…). With
// `force-static` Next would prerender ONE response with empty params at build
// time and serve it for every request, silently ignoring the filters. The
// Cache-Control header below still makes responses cacheable at the CDN/browser.
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const data = getInstruments({
    region: (sp.get('region') as InstrumentRegion) || undefined,
    category: (sp.get('category') as InstrumentCategory) || undefined,
    tradition: sp.get('tradition') || undefined,
    mood: sp.get('mood') || undefined,
    q: sp.get('q') || undefined,
  });

  return NextResponse.json(
    { success: true, data, total: data.length },
    { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } }
  );
}
