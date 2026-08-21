/** @jest-environment node */
/**
 * Tests for the GA4 production-host gate.
 *
 * The gate exists because Amplify preview branches, `localhost`, and any
 * staging alias would otherwise fire the same GA4 property as production —
 * every dev iteration polluting the "real" dashboard. Kept as a pure fn of the
 * hostname so we don't need JSDOM + `window.location` mocking here.
 * The runtime binding is exercised in <GoogleAnalytics> via useEffect
 * (SSR/client parity — no hydration mismatch).
 */

import { isProductionHostForAnalytics, PRODUCTION_HOSTS_FOR_ANALYTICS } from '@/lib/analytics';

describe('isProductionHostForAnalytics', () => {
  it.each([
    ['tamilagaval.com'],
    ['www.tamilagaval.com'],
  ])('allows production host: %s', (host) => {
    expect(isProductionHostForAnalytics(host)).toBe(true);
  });

  it.each([
    // Amplify branch preview
    ['branch--feat-x.d3rkmepk4popv0.amplifyapp.com'],
    ['d3rkmepk4popv0.amplifyapp.com'],
    // Local dev
    ['localhost'],
    ['127.0.0.1'],
    // Staging / typo squats
    ['staging.tamilagaval.com'],
    ['tamilagaval.com.evil.example'],
    ['xn--tamilagaval-example.com'], // punycode lookalike
    // Empty (never returned by browsers but defensive)
    [''],
  ])('rejects non-production host: %s', (host) => {
    expect(isProductionHostForAnalytics(host)).toBe(false);
  });

  it('is case-sensitive — matches only exact lower-case', () => {
    // `window.location.hostname` is always lower-cased by browsers, so this
    // asserts the current contract. If it ever needs to become
    // case-insensitive, update both the fn and this test together.
    expect(isProductionHostForAnalytics('Tamilagaval.com')).toBe(false);
    expect(isProductionHostForAnalytics('TAMILAGAVAL.COM')).toBe(false);
  });

  it('exports the underlying Set so callers can enumerate for docs/UIs', () => {
    // The Set is what the fn wraps; keep them wired together.
    expect(PRODUCTION_HOSTS_FOR_ANALYTICS.has('tamilagaval.com')).toBe(true);
    expect(PRODUCTION_HOSTS_FOR_ANALYTICS.size).toBe(2);
  });
});
