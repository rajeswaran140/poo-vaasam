/** @jest-environment node */
/**
 * ⚠️ Every content LIST page must carry the deliberate freshness header.
 *
 * `/all` was missing from `FRESH_CONTENT_PATHS` (found 2026-08-18) and was the
 * only list page served `Cache-Control: no-store` — every visit and every crawl
 * paid a full origin render of a 319 KB page (TTFB 0.91s vs 0.50s for /songs),
 * and Search Console listed it as not-indexed. A silent omission, not a choice.
 *
 * This test exists so the next list page added to the site is noticed here too.
 */

import { readFileSync } from 'node:fs';

const src = readFileSync('src/middleware.ts', 'utf8');
const listed = (src.match(/const FRESH_CONTENT_PATHS = new Set\(\[([^\]]+)\]/s)?.[1] ?? '')
  .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

describe('content list pages get the freshness header', () => {
  it.each(['/', '/all', '/songs', '/poems', '/videos'])('includes %s', (p) => {
    expect(listed).toContain(p);
  });

  it('sets s-maxage so CloudFront still caches, with max-age=0 for the browser', () => {
    expect(src).toMatch(/max-age=0/);
    expect(src).toMatch(/s-maxage=300/);
    expect(src).toMatch(/stale-while-revalidate=60/);
  });

  /** The bug was an omission — so assert the set is non-trivial, not just present. */
  it('lists every browse surface, not merely a couple', () => {
    expect(listed.length).toBeGreaterThanOrEqual(8);
  });
});
