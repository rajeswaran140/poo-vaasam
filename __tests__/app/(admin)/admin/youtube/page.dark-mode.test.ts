/** @jest-environment node */
/**
 * Dark-mode coverage guard for /admin/youtube.
 *
 * The page is an async server component that pulls in the DynamoDB / GA4 /
 * YouTube dependency graph at module load, so rendering it in jsdom is
 * impractical. Instead we assert the invariant the audit fixed: every light
 * surface / text utility ships a `dark:` counterpart, so the dashboard stays
 * readable when the admin theme is dark (it previously had ZERO dark variants).
 *
 * This is a source scan (no import), so it covers the inline JSX cards, the
 * table, the colored banners, and the small presentational components alike —
 * and it fails loudly if a future edit reintroduces a light-only element.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(process.cwd(), 'src/app/(admin)/admin/youtube/page.tsx'),
  'utf8'
);

// Light-mode surface/text utilities that MUST be paired with a dark: variant.
// (Accent colors like bg-orange-500 bar fills and orange-600 links are
// intentionally theme-independent and are excluded below.)
const LIGHT_SURFACE =
  /\b(?:bg-white|bg-gray-(?:50|100)|text-gray-(?:500|600|700|800|900)|border-gray-(?:200|300)|divide-gray-100|bg-(?:amber|red|orange|green)-(?:50|100)|text-(?:amber|red|orange|green)-(?:700|800|900))\b/;

describe('/admin/youtube — dark-mode coverage', () => {
  const offenders = SRC.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => LIGHT_SURFACE.test(line) && !line.includes('dark:'))
    // The vivid progress-bar fill is intentionally identical in both themes.
    .filter(({ line }) => !line.includes('bg-orange-500'));

  it('has no light-only surface/text utilities — each pairs with a dark: variant', () => {
    expect(offenders.map((o) => `L${o.n}: ${o.line}`)).toEqual([]);
  });

  it('defines dark variants broadly across the page (sanity floor)', () => {
    const count = (SRC.match(/dark:/g) || []).length;
    expect(count).toBeGreaterThan(40);
  });

  it('keeps the header and section headings readable in dark mode', () => {
    // Both the page <h1> and the "Latest videos" <h2> sat dark-on-dark before.
    expect(/text-2xl font-bold text-gray-900 dark:text-gray-100/.test(SRC)).toBe(true);
    expect(/text-lg font-semibold text-gray-900 dark:text-gray-100/.test(SRC)).toBe(true);
  });
});
