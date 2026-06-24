/** @jest-environment node */
/**
 * The /clips static assets (Status-share clips + their posters) are content-
 * stable, so next.config must cache them hard (immutable, 1 year). Without this
 * they fall back to the platform default (max-age=5) — re-downloading the
 * ~1.3 MB clip on every repeat visit and every Web Share file fetch.
 */
import nextConfig from '../../next.config';

it('caches /clips/* immutably for a year', async () => {
  const headers = await nextConfig.headers!();
  const rule = headers.find((h) => h.source === '/clips/:path*');
  expect(rule).toBeDefined();

  const cacheControl = rule!.headers.find((h) => h.key === 'Cache-Control')?.value ?? '';
  expect(cacheControl).toMatch(/immutable/);
  expect(cacheControl).toMatch(/max-age=31536000/);
});
