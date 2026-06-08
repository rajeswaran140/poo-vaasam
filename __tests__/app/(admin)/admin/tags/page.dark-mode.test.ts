/** @jest-environment node */
/**
 * Dark-mode coverage guard for /admin/tags — asserts every light surface/text
 * utility ships a `dark:` counterpart (the page previously had none, so in dark
 * mode the header was dark-on-dark and the cards/input/rows stayed white).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(process.cwd(), 'src/app/(admin)/admin/tags/page.tsx'), 'utf8');

// Accent colors (purple chips/buttons, the red delete dot, bg-white/20 badge)
// are intentionally theme-independent and not matched here.
const LIGHT_SURFACE =
  /\b(?:bg-white|bg-gray-(?:50|100)|text-gray-(?:500|600|700|800|900)|border-gray-(?:200|300))\b/;

describe('/admin/tags — dark-mode coverage', () => {
  const offenders = SRC.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => LIGHT_SURFACE.test(line) && !line.includes('dark:'));

  it('has no light-only surface/text utilities — each pairs with a dark: variant', () => {
    expect(offenders.map((o) => `L${o.n}: ${o.line}`)).toEqual([]);
  });

  it('keeps the header readable in dark mode', () => {
    expect(/text-2xl font-bold text-gray-900 dark:text-gray-100/.test(SRC)).toBe(true);
  });
});
