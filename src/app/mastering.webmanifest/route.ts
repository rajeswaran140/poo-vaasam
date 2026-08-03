/**
 * GET /mastering.webmanifest — the Mastering studio's Web App Manifest.
 *
 * Served from the PUBLIC root rather than under /admin because a manifest is
 * fetched without credentials and middleware would redirect an /admin path to
 * the login page (see src/lib/mastering-manifest.ts). Unauthenticated readers
 * learn only the app's name, colours and icon paths.
 *
 * The `application/manifest+json` content type is not cosmetic: browsers reject
 * a manifest served as text/plain or application/json.
 */

import { NextResponse } from 'next/server';
import { masteringManifest } from '@/lib/mastering-manifest';

export const dynamic = 'force-static';

export function GET() {
  // Cache-Control is deliberately NOT set here. next.config.ts already applies
  // `public, max-age=0, s-maxage=300, stale-while-revalidate=86400` to every
  // path outside /api, /admin, /login and /debug, and a config header wins over
  // one set in the handler — so anything written here would be dead code that
  // reads as policy. Those values suit a manifest fine.
  return NextResponse.json(masteringManifest(), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}
