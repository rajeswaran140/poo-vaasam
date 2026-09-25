/** @jest-environment node */
/**
 * The CSP is the app's main defence against injected script. The property that
 * matters most is negative — `'unsafe-eval'` must never reach production — so
 * it is asserted directly rather than left to a header snapshot.
 */
import { buildContentSecurityPolicy, buildStrictTransportSecurity } from '@/config/csp';

/** Pull one directive out of the policy string. */
const directive = (policy: string, name: string): string =>
  policy
    .split('; ')
    .find((d) => d.startsWith(`${name} `))!;

describe('Content Security Policy', () => {
  const prod = buildContentSecurityPolicy('production');
  const dev = buildContentSecurityPolicy('development');
  const test = buildContentSecurityPolicy('test');

  describe("'unsafe-eval' is dev-only", () => {
    it('is NOT present in production', () => {
      expect(prod).not.toContain("'unsafe-eval'");
    });

    it.each([
      ['development', dev],
      ['test', test],
    ])('is present in %s, where next dev HMR needs it', (_env, policy) => {
      expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
    });

    it('is absent for an undefined NODE_ENV only if that is not production', () => {
      // Guards the ternary's default branch: an unset env must not be treated
      // as production (which would silently drop eval and break `next dev`).
      expect(buildContentSecurityPolicy(undefined)).toContain("'unsafe-eval'");
    });
  });

  describe('directives that must hold in every environment', () => {
    it.each([
      ["default-src 'self'"],
      ["base-uri 'self'"],
      ["object-src 'none'"],
      ["frame-ancestors 'self'"],
      ["form-action 'self'"],
      // NOTE: `upgrade-insecure-requests` is deliberately NOT in this list any
      // more — it is production-only. See its own describe block below.
    ])('includes %s', (expected) => {
      expect(prod).toContain(expected);
      expect(dev).toContain(expected);
    });

    it('keeps GA4 reachable, or analytics silently records nothing', () => {
      expect(directive(prod, 'script-src')).toContain('https://www.googletagmanager.com');
      expect(directive(prod, 'connect-src')).toContain('https://www.google-analytics.com');
      expect(directive(prod, 'connect-src')).toContain('https://*.analytics.google.com');
      expect(directive(prod, 'connect-src')).toContain('https://www.googletagmanager.com');
    });

    describe('connect-src is tight (no bare `https:` wildcard)', () => {
      // Regression guard for the 2026-08-21 tightening: the previous policy
      // allowed `https:` — any HTTPS host — as an exfil destination if XSS
      // ever landed via `'unsafe-inline'` script-src. Do not reintroduce it.
      it('does NOT allow the bare `https:` scheme in connect-src', () => {
        // Match a bare `https:` token (with a trailing space), not `https://…`.
        const connect = directive(prod, 'connect-src');
        expect(connect).not.toMatch(/(^|\s)https:(\s|$)/);
      });

      it.each([
        ['Cognito + S3 presigned uploads', 'https://*.amazonaws.com'],
        ['CloudFront media distro (MEDIA_BASE_URL)', 'https://d2cdoh43143xxa.cloudfront.net'],
        ['YouTube thumbnail preflight (video-thumbnails.ts)', 'https://i.ytimg.com'],
        // Restored 2026-08-27 after the 2026-08-21 tightening broke Tamil typing
        // in the compose forms. react-transliterate posts to this endpoint for
        // English→Tamil word suggestions; blocking it silently disables the
        // suggestion popup and makes the "English → Tamil" mode dead.
        ['react-transliterate English→Tamil suggestions', 'https://inputtools.google.com'],
      ])('allows %s', (_purpose, host) => {
        expect(directive(prod, 'connect-src')).toContain(host);
      });
    });

    it('keeps YouTube embeddable', () => {
      expect(directive(prod, 'frame-src')).toContain('https://www.youtube.com');
      expect(directive(prod, 'frame-src')).toContain('https://www.youtube-nocookie.com');
    });

    it("retains script-src 'unsafe-inline' — static pre-rendering rules out nonces", () => {
      // Documented trade-off, not an oversight: pages are pre-rendered and
      // CDN-cached, so a per-request nonce cannot be unique per visitor.
      // Asserted so removing it is a deliberate decision with a failing test.
      expect(directive(prod, 'script-src')).toContain("'unsafe-inline'");
    });
  });

  /**
   * The two environments differ by EXACTLY two directives and nothing else.
   * Spelled out as a round trip so that any third divergence — a stray host, a
   * relaxed source list — fails here rather than shipping unnoticed.
   */
  it('differs between prod and dev by exactly the eval and upgrade directives', () => {
    expect(dev.replace(" 'unsafe-eval'", '') + '; upgrade-insecure-requests').toBe(prod);
  });
});

/**
 * ⚠️ `upgrade-insecure-requests` MUST NOT BE SENT IN DEVELOPMENT.
 *
 * It tells the browser to rewrite every http:// request on the page to
 * https://. In production that is exactly right — the site is HTTPS and the
 * directive is a safety net. On http://localhost it is a trap:
 *
 *   - WebKit HONOURS it for localhost. Clicking any internal link on the dev
 *     server issued `GET https://localhost:3000/...`, the plain-HTTP dev server
 *     failed the TLS handshake, and the navigation silently died — the URL just
 *     never changed. Measured 2026-09-24; it cost most of a day in the E2E
 *     suite, where it looked like a broken selector.
 *   - Chromium does NOT, because it treats localhost as a trustworthy origin.
 *     So the bug is invisible in the browser most people develop in.
 *
 * Production keeps the directive. Nothing about the deployed site changes.
 */
describe('upgrade-insecure-requests is production-only', () => {
  const prod = buildContentSecurityPolicy('production');
  const dev = buildContentSecurityPolicy('development');
  const test = buildContentSecurityPolicy('test');

  it('is present in production, where the site really is HTTPS', () => {
    expect(prod).toContain('upgrade-insecure-requests');
  });

  it.each([
    ['development', dev],
    ['test', test],
  ])('is ABSENT in %s, where it breaks navigation on http://localhost', (_env, policy) => {
    expect(policy).not.toContain('upgrade-insecure-requests');
  });
});

/**
 * ⚠️ HSTS MUST NOT BE SENT FROM THE DEV SERVER EITHER, and this one is worse
 * than the CSP directive because it PERSISTS.
 *
 * `Strict-Transport-Security` tells the browser to use HTTPS for this host from
 * now on, and browsers cache that. Sent from http://localhost it poisons the
 * HSTS cache for `localhost` itself — which then forces HTTPS on every OTHER
 * project served from localhost on that machine, long after this server is
 * gone, and survives a restart. Clearing it means a trip through the browser's
 * internals.
 *
 * Same family as the upgrade-insecure-requests bug above: a production security
 * header applied to a plain-HTTP dev origin.
 */
describe('Strict-Transport-Security is production-only', () => {
  it('is sent in production', () => {
    expect(buildStrictTransportSecurity('production')).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
  });

  it.each([['development'], ['test']])(
    'is NOT sent in %s, where it would poison the HSTS cache for localhost',
    (env) => {
      expect(buildStrictTransportSecurity(env)).toBeNull();
    }
  );
});
