/** @jest-environment node */
/**
 * Public pages are `force-dynamic` (Amplify SSR can't run ISR reliably), so the
 * CDN cache-control header IS the freshness mechanism. These tests pin the two
 * properties that matter:
 *
 *  1. stale-while-revalidate is long, so visitors don't pay a Lambda cold start
 *     (measured ~5.8s) while s-maxage stays short enough that new uploads
 *     still appear promptly.
 *  2. the rule NEVER reaches /api or /admin. A shared `public` CDN cache in
 *     front of an authenticated response is a data-leak bug, not a perf win.
 */
import nextConfig from '../../next.config';

const PUBLIC_CACHE_SOURCE = '/((?!api/|admin|login|debug).*)';

async function publicCacheRule() {
  const headers = await nextConfig.headers!();
  return headers.find((h) => h.source === PUBLIC_CACHE_SOURCE);
}

describe('public page cache-control', () => {
  it('serves stale immediately while revalidating in the background', async () => {
    const rule = await publicCacheRule();
    expect(rule).toBeDefined();

    const value = rule!.headers.find((h) => h.key === 'Cache-Control')?.value ?? '';
    expect(value).toMatch(/stale-while-revalidate=86400/);
    // Short revalidation window keeps new uploads visible — raising this would
    // trade upload freshness for speed, which SWR already gives us for free.
    expect(value).toMatch(/s-maxage=300\b/);
    expect(value).toMatch(/\bpublic\b/);
  });

  it.each([
    ['/api/admin/youtube/metrics/snapshot', false],
    ['/api/songs', false],
    ['/admin', false],
    ['/admin/analytics', false],
    ['/login', false],
    ['/debug-auth', false],
    ['/videos', true],
    ['/songs/love', true],
    ['/content/cnt_123', true],
    ['/', true],
  ])('%s is cacheable=%s', (path, shouldMatch) => {
    // next.config `source` is path-to-regexp; for this pattern the group body is
    // used verbatim as a regex, so matching it directly reflects real routing.
    const re = new RegExp(`^${PUBLIC_CACHE_SOURCE}$`);
    expect(re.test(path)).toBe(shouldMatch);
  });
});

describe('image optimizer config', () => {
  it('caps deviceSizes at 1920 — no source on the site can fill 2048/3840', async () => {
    const sizes = nextConfig.images?.deviceSizes ?? [];
    expect(Math.max(...sizes)).toBe(1920);
    expect(sizes).not.toContain(3840);
    expect(sizes).not.toContain(2048);
    // 2x headroom for poem art and hero images must remain.
    expect(sizes).toContain(1920);
  });

  it('caches derived images for a week — ytimg content is immutable per video id', () => {
    expect(nextConfig.images?.minimumCacheTTL).toBeGreaterThanOrEqual(604800);
  });
});
