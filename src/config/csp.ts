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
    // connect-src https: already covers google-analytics.com/g/collect, but
    // listing the GA hostnames explicitly makes the dependency obvious.
    "connect-src 'self' https: https://www.google-analytics.com https://*.analytics.google.com",
    "media-src 'self' blob: https:",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    'upgrade-insecure-requests',
  ].join('; ');
}

export const contentSecurityPolicy = buildContentSecurityPolicy();
