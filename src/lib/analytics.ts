/**
 * Google tracking IDs.
 *
 * Read at build time from NEXT_PUBLIC_ env vars so Amplify can supply real
 * values without a code change. To activate tracking, set these in
 * Amplify Console → App settings → Environment variables, then redeploy:
 *
 *   NEXT_PUBLIC_GA_ID                       e.g. G-XXXXXXXXXX
 *                                           (Google Analytics 4 Measurement ID)
 *   NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION    e.g. "abc123…"
 *                                           (Search Console HTML-tag method;
 *                                            unused if you verified by DNS)
 *
 * When NEXT_PUBLIC_GA_ID is empty no scripts ship and no requests fire.
 */
// Default to the live GA4 property (Measurement IDs are public by design —
// they ship to the browser in the gtag script URL); env var overrides for
// staging / personal forks.
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-W2GGGP926B';
export const GOOGLE_SITE_VERIFICATION = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || '';

/**
 * Hostnames on which GA4 is allowed to fire. Every other host — Amplify preview
 * branches (`<hash>.amplifyapp.com`), `localhost`, staging aliases — is a
 * pre-production surface whose visits must NOT count toward the production GA4
 * property. Kept as a pure function of the hostname so it's unit-testable
 * without mocking `window.location`. Guarded again at render time in
 * `<GoogleAnalytics>` (with a `useEffect` gate so SSR + client agree on the
 * initial render — no hydration mismatch).
 */
export const PRODUCTION_HOSTS_FOR_ANALYTICS = new Set([
  'tamilagaval.com',
  'www.tamilagaval.com',
]);

export function isProductionHostForAnalytics(hostname: string): boolean {
  return PRODUCTION_HOSTS_FOR_ANALYTICS.has(hostname);
}

/**
 * Route prefixes whose page views must NEVER reach the production GA4 property.
 *
 * These are operator surfaces, not audience surfaces. The 2026-09-12 GA4 audit
 * measured 380 of 745 page views over 28 days — 51% — landing on /admin,
 * /login or /debug-auth. That is one person working, and it silently inflated
 * every headline metric: `/admin/mastering` alone was 100 page views, so the
 * 4m26s "average session duration" largely described time spent in the
 * mastering studio rather than anything a visitor did.
 *
 * Excluding in code rather than with a GA4 internal-traffic IP filter is
 * deliberate: an IP filter breaks the moment the operator works from a
 * different network, and GA4 ships those filters in "Testing" mode where they
 * silently do nothing until someone remembers to activate them.
 */
export const ANALYTICS_EXCLUDED_PATH_PREFIXES = ['/admin', '/login', '/debug-auth'] as const;

/**
 * True when `pathname` is an operator surface that must not be tracked.
 *
 * Matches the prefix itself and anything beneath it, but NOT a public path that
 * merely shares its opening characters — `/administrators` and `/logins` are
 * ordinary pages and keep their analytics. Pure function of the path so it is
 * testable without rendering React or touching `window`.
 */
export function isAnalyticsExcludedPath(pathname: string): boolean {
  if (!pathname || !pathname.startsWith('/')) return false;
  return ANALYTICS_EXCLUDED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
