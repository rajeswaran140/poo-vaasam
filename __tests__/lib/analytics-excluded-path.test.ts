/** @jest-environment node */
/**
 * `isAnalyticsExcludedPath` — the pure gate that keeps the operator's own
 * admin sessions out of the production GA4 property.
 *
 * The 2026-09-12 GA4 audit found 380 of 745 page views over 28 days (51%) were
 * /admin, /login or /debug-auth — Raj's own work. That inflated every headline
 * metric: average session duration was mostly time spent in the mastering
 * studio. This gate is the fix, and it lives here (not in the component) so it
 * can be asserted without rendering React.
 */

import { isAnalyticsExcludedPath } from '@/lib/analytics';

describe('isAnalyticsExcludedPath', () => {
  it.each([
    '/admin',
    '/admin/',
    '/admin/mastering',
    '/admin/compose/critique',
    '/admin/docs',
    '/login',
    '/login/',
    '/debug-auth',
  ])('excludes %s', (p) => {
    expect(isAnalyticsExcludedPath(p)).toBe(true);
  });

  it.each([
    '/',
    '/songs',
    '/songs/nature',
    '/about',
    '/stories',
    '/videos',
    '/content/cnt_123',
    '/lyrics/some-slug',
    '/share',
  ])('allows %s', (p) => {
    expect(isAnalyticsExcludedPath(p)).toBe(false);
  });

  it('does not treat a public path that merely starts with the same letters as admin', () => {
    // `/administrators` and `/logins` are not admin surfaces — a naive
    // startsWith() would wrongly drop their analytics.
    expect(isAnalyticsExcludedPath('/administrators')).toBe(false);
    expect(isAnalyticsExcludedPath('/logins')).toBe(false);
    expect(isAnalyticsExcludedPath('/admins')).toBe(false);
  });

  it('is defensive about empty or malformed input', () => {
    expect(isAnalyticsExcludedPath('')).toBe(false);
    expect(isAnalyticsExcludedPath('admin')).toBe(false);
  });
});
