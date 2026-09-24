/**
 * Content Security Policy.
 *
 * Lives in its own module (rather than inline in next.config.ts) so the policy
 * can be asserted in tests without booting Next. next.config.ts imports it via a
 * relative path — the `@/` alias is not available that early.
 *
 * Notes on why each non-trivial source is allowed:
 * - script-src 'unsafe-eval': needed ONLY by `next dev`, whose HMR runtime evals
 *   modules. A production build never evals, so the directive is emitted in dev
 *   only — it is the directive that most weakens CSP (it turns any injected
 *   string into executable code), and there is no reason to ship it live.
 * - script-src 'unsafe-inline': Next's App Router inlines its bootstrap script
 *   and streams the RSC payload via inline `self.__next_f.push(...)` calls.
 *   Removing it requires a per-request nonce, which cannot work here: the public
 *   pages are statically pre-rendered (`export const revalidate = false`) and
 *   cached by CloudFront, so every visitor would be served one visitor's nonce.
 *   Kept deliberately — see HARDENING.md. The residual risk is small in practice:
 *   the app has exactly one `dangerouslySetInnerHTML` (JsonLd, which escapes
 *   <, > and &) and renders no user-supplied HTML.
 * - style-src 'unsafe-inline': Next and react-hot-toast emit inline styles.
 *   Fonts are self-hosted via next/font, so no fonts.gstatic.com is needed.
 * - img-src https: (YouTube thumbnails i.ytimg.com + S3); media-src https:
 *   (incompetech.com royalty-free audio + S3); frame-src for YouTube embeds.
 */

/** Build the policy string for a given environment. */
export function buildContentSecurityPolicy(
  nodeEnv: string | undefined = process.env.NODE_ENV
): string {
  const isProduction = nodeEnv === 'production';

  const scriptSrc = [
    "script-src 'self' 'unsafe-inline'",
    // Dev-only: `next dev`'s HMR runtime needs eval. Never shipped to production.
    ...(isProduction ? [] : ["'unsafe-eval'"]),
    'https://www.googletagmanager.com',
  ].join(' ');

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    // GA4 needs googletagmanager.com (loader) + google-analytics.com (events).
    // Without these, the gtag <script> is blocked → 0 events ever reach GA4.
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // connect-src: browser-side outbound. Tightened 2026-08-21 — was
    // `'self' https:` which allowed exfil to any HTTPS host if XSS ever landed
    // via `'unsafe-inline'` script-src. Now enumerated to only what the app
    // actually calls from the browser:
    //   google-analytics.com + *.analytics.google.com  gtag pings
    //   googletagmanager.com                           gtag config fetches
    //   *.amazonaws.com                                Cognito auth + S3
    //                                                  presigned uploads
    //                                                  (wildcard because bucket
    //                                                  names + region endpoints
    //                                                  multiply; IAM scopes
    //                                                  what's actually reachable)
    //   d2cdoh43143xxa.cloudfront.net                  MEDIA_BASE_URL — the
    //                                                  CloudFront distro
    //                                                  fronting tamil-web-media
    //   i.ytimg.com                                    thumbnail preflight
    //                                                  (video-thumbnails.ts)
    //   inputtools.google.com                          react-transliterate's
    //                                                  English→Tamil suggestion
    //                                                  API (LyricDraftEditor,
    //                                                  TamilInput/-textarea,
    //                                                  lib/transliterate.ts).
    //                                                  Missed in the 2026-08-21
    //                                                  tightening — restored
    //                                                  2026-08-27 after Raj
    //                                                  reported Tamil typing
    //                                                  had stopped working
    //                                                  in the compose forms.
    // If a legitimate new destination appears (Sentry, Datadog RUM, a new
    // API…), add it here — the failure will be a browser CSP violation, not
    // silent success.
    "connect-src 'self' " +
      'https://www.google-analytics.com https://*.analytics.google.com ' +
      'https://www.googletagmanager.com ' +
      'https://*.amazonaws.com ' +
      'https://d2cdoh43143xxa.cloudfront.net ' +
      'https://i.ytimg.com ' +
      'https://inputtools.google.com',
    "media-src 'self' blob: https:",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    /**
     * ⚠️ PRODUCTION ONLY, and this is not a nicety.
     *
     * The directive tells the browser to rewrite every http:// request on the
     * page as https://. On the deployed site that is a free safety net. On
     * http://localhost it BREAKS NAVIGATION, and only in some browsers:
     *
     *   - WebKit honours it for localhost, so every internal link on the dev
     *     server issued `GET https://localhost:3000/...`, the plain-HTTP dev
     *     server failed the TLS handshake, and the navigation died silently —
     *     the URL simply never changed, with no error in the page.
     *   - Chromium exempts localhost as a trustworthy origin, so it is
     *     invisible in the browser most of this work happens in.
     *
     * Diagnosed 2026-09-24 after it spent a day masquerading as a broken
     * Playwright selector in the WebKit projects.
     */
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export const contentSecurityPolicy = buildContentSecurityPolicy();

/**
 * `Strict-Transport-Security`, or null when it must not be sent.
 *
 * ⚠️ PRODUCTION ONLY, and this one PERSISTS in a way the CSP directive does
 * not. HSTS tells the browser to use HTTPS for this host from now on, and the
 * browser caches that. Sent from http://localhost it poisons the HSTS cache for
 * `localhost` itself — which then forces HTTPS on every OTHER project served
 * from localhost on that machine, outlives this server, survives a restart, and
 * has to be cleared through the browser's internals.
 *
 * Same family as `upgrade-insecure-requests` above: a production security
 * header applied to a plain-HTTP dev origin.
 */
export function buildStrictTransportSecurity(
  nodeEnv: string | undefined = process.env.NODE_ENV
): string | null {
  return nodeEnv === 'production' ? 'max-age=63072000; includeSubDomains; preload' : null;
}

export const strictTransportSecurity = buildStrictTransportSecurity();
