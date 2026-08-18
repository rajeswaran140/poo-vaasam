/** @jest-environment node */
/**
 * ⚠️ NOT every content link is `/content/<id>`.
 *
 * Some items have a VANITY PATH (`src/config/vanity-paths.ts`) and render as
 * e.g. `/thayagam`. On 2026-08-18 an audit of /all counted only
 * `href="/content/…"` links, found 55 against 56 published rows, and reported a
 * missing song. Nothing was missing — `எங்கள் தேசம்` was on the page under its
 * vanity path. A real bug was invented, "fixed", and shipped with a commit
 * message asserting a measurement that was wrong.
 *
 * This test pins the fact that made the audit wrong, so the next person
 * counting links on a listing page counts both shapes.
 */

import { contentPath } from '@/config/vanity-paths';

describe('content links come in two shapes', () => {
  it('returns a vanity path for an item that has one', () => {
    expect(contentPath('cnt_1781049094952_wstyqacm4')).toBe('/thayagam');
  });

  it('falls back to /content/<id> for an item that does not', () => {
    expect(contentPath('cnt_does_not_exist')).toBe('/content/cnt_does_not_exist');
  });

  /**
   * The lesson, asserted: counting only /content/ links UNDERCOUNTS a listing
   * page by exactly the number of vanity-path items.
   */
  it('means a /content/-only count is not a count of all items', () => {
    const ids = ['cnt_1781049094952_wstyqacm4', 'cnt_ordinary_one'];
    const paths = ids.map(contentPath);
    const contentOnly = paths.filter((p) => p.startsWith('/content/'));
    expect(paths).toHaveLength(2);
    expect(contentOnly).toHaveLength(1);   // ← the undercount that caused the false alarm
  });
});
