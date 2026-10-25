/** @jest-environment node */
/**
 * /admin gets its own Content-Security-Policy (adds `worker-src 'self' blob:`
 * for the studio listening test). Next applies every matching `headers()`
 * entry and, for the same key, the LATER entry wins, so these tests resolve
 * the last matching CSP entry per path with Next's own matcher.
 */
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import nextConfig from '../../next.config';
import { adminContentSecurityPolicy, contentSecurityPolicy } from '../../src/config/csp';

const CSP = 'Content-Security-Policy';

async function cspFor(path: string): Promise<string | undefined> {
  const entries = await nextConfig.headers!();
  let value: string | undefined;
  for (const entry of entries) {
    const matches = getPathMatch(entry.source, { strict: true, removeUnnamedParams: true })(path);
    const csp = entry.headers.find((h) => h.key === CSP);
    if (matches && csp) value = csp.value;
  }
  return value;
}

describe('per-route Content-Security-Policy', () => {
  it.each(['/admin', '/admin/music-lab/studio-test'])('%s gets the admin policy', async (path) => {
    expect(await cspFor(path)).toBe(adminContentSecurityPolicy);
  });

  it.each(['/songs', '/content/abc', '/stories', '/login', '/administrator'])(
    '%s keeps the public policy',
    async (path) => {
      expect(await cspFor(path)).toBe(contentSecurityPolicy);
    }
  );

  it('the admin policy differs from the public one only by worker-src', () => {
    expect(adminContentSecurityPolicy).toBe(`${contentSecurityPolicy}; worker-src 'self' blob:`);
  });

  it('the admin entry sets only the CSP, so every other header still comes from /:path*', async () => {
    const entries = await nextConfig.headers!();
    const admin = entries.filter((e) => e.source === '/admin/:path*');
    expect(admin).toHaveLength(1);
    expect(admin[0].headers.map((h) => h.key)).toEqual([CSP]);
  });
});
