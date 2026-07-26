/** @jest-environment node */
/**
 * The CSP is the app's main defence against injected script. The property that
 * matters most is negative — `'unsafe-eval'` must never reach production — so
 * it is asserted directly rather than left to a header snapshot.
 */
import { buildContentSecurityPolicy } from '@/config/csp';

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
      ['upgrade-insecure-requests'],
    ])('includes %s', (expected) => {
      expect(prod).toContain(expected);
      expect(dev).toContain(expected);
    });

    it('keeps GA4 reachable, or analytics silently records nothing', () => {
      expect(directive(prod, 'script-src')).toContain('https://www.googletagmanager.com');
      expect(directive(prod, 'connect-src')).toContain('https://www.google-analytics.com');
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

  it('differs between prod and dev only by the eval directive', () => {
    expect(dev.replace(" 'unsafe-eval'", '')).toBe(prod);
  });
});
