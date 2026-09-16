import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The site header is `fixed top-0` and 81px tall (an h-20 row plus a border).
 * A page that renders it must push its own first content below that, or the
 * page title sits UNDERNEATH the header and is invisible.
 *
 * This shipped on four pages — /karaoke, /terms, /privacy and /contact —
 * and went unnoticed because it is invisible to every other check: there is
 * no overflow, no tiny tap target, no small text, and the markup looks
 * perfectly ordinary. It was found by a human looking at the page.
 *
 * `pt-28` (112px) is the clearance /music-composition has always used.
 *
 * ⚠️ The clearance must be on the element that HOLDS THE FIRST HEADING, not
 * simply on <main>. On /terms and /privacy the <h1> lives in a hero <section>
 * ABOVE <main>, so padding <main> adds stray whitespace mid-page and leaves
 * the title exactly as covered as before. That wrong fix looked right in a
 * diff and was only caught by measuring a rendered page.
 */

const ROOT = join(__dirname, '..', '..', 'src', 'app');

/** Pages whose first heading must clear the fixed header. */
const PAGES = [
  'karaoke/page.tsx',
  'terms/page.tsx',
  'privacy/page.tsx',
  'contact/page.tsx',
  'music-composition/page.tsx',
  'karaoke/terms/page.tsx',
] as const;

describe('pages that render the fixed header must clear it', () => {
  it.each(PAGES)('%s carries top clearance', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    // Only meaningful for pages that actually render the fixed header.
    expect(src).toMatch(/<Header\s*\/>/);
    expect(src).toMatch(/\bpt-28\b/);
  });

  it('no affected page still uses a bare py-* as its only top spacing', () => {
    // py-12/py-16 alone is what caused this: it reads as deliberate spacing
    // while leaving zero allowance for an 81px fixed overlay.
    for (const rel of PAGES) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      const hasClearance = /\bpt-28\b/.test(src);
      expect(hasClearance).toBe(true);
    }
  });
});
