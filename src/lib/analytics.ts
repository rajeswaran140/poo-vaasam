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
