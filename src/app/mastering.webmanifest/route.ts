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
  return NextResponse.json(masteringManifest(), {
    headers: {
      'Content-Type': 'application/manifest+json',
      // Long-lived but revalidated: an install reads this once, and a stale
      // copy would keep serving old icons after a rebrand.
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
