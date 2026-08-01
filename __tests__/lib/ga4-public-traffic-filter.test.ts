/** @jest-environment node */
/**
 * The /admin/analytics traffic reports must exclude the operator's own admin
 * browsing. Measured 2026-08-01: 275 of 594 pageviews over 28 days were
 * `/admin*` — 46% — and `/admin`, `/admin/mastering` and `/admin/youtube` sat
 * 2nd/3rd/4th in "Top pages", above `/videos` and `/songs`.
 *
 * These tests pin the filter's SHAPE rather than mocking the GA4 client,
 * because the failure mode is a silently-missing filter, not a malformed one.
 */
import { publicTrafficFilter, NON_PUBLIC_PATH_PREFIXES } from '@/lib/ga4-api';

type Expr = { filter: { fieldName: string; stringFilter: { matchType: string; value: string } } };

describe('publicTrafficFilter', () => {
  it('is a NOT over an OR of BEGINS_WITH pagePath matches', () => {
    const f = publicTrafficFilter() as any;
    expect(f.notExpression).toBeDefined();
    const exprs: Expr[] = f.notExpression.orGroup.expressions;
    expect(exprs).toHaveLength(NON_PUBLIC_PATH_PREFIXES.length);
    for (const e of exprs) {
      expect(e.filter.fieldName).toBe('pagePath');
      expect(e.filter.stringFilter.matchType).toBe('BEGINS_WITH');
    }
  });

  it('covers every non-public prefix, /admin included', () => {
    const values = (publicTrafficFilter() as any).notExpression.orGroup.expressions.map(
      (e: Expr) => e.filter.stringFilter.value
    );
    expect(values).toEqual(expect.arrayContaining(['/admin', '/login', '/debug']));
    expect(new Set(values).size).toBe(values.length); // no duplicate prefixes
  });

  /**
   * Mirrors GA4's BEGINS_WITH semantics so the intent is pinned independently
   * of the payload shape: a regression that swapped BEGINS_WITH for EXACT would
   * keep /admin/mastering — the 3rd-ranked page — in the report.
   */
  it.each([
    ['/admin', false],
    ['/admin/mastering', false],
    ['/admin/youtube', false],
    ['/login', false],
    ['/debug-auth', false],
    ['/', true],
    ['/videos', true],
    ['/songs/love', true],
    ['/content/cnt_123', true],
    // Not a false positive: a public path that merely CONTAINS "admin".
    ['/songs/adminaa', true],
  ])('%s is public=%s', (path, isPublic) => {
    const prefixes = (publicTrafficFilter() as any).notExpression.orGroup.expressions.map(
      (e: Expr) => e.filter.stringFilter.value
    );
    const excluded = prefixes.some((p: string) => path.startsWith(p));
    expect(!excluded).toBe(isPublic);
  });
});
