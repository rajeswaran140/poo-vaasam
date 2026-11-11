/**
 * Guards that admin pages are actually reachable through the sidebar.
 *
 * admin-nav.ts is the single source of truth for both the sidebar and the
 * command palette. A page can exist under src/app/(admin)/ and still be
 * unreachable if nobody adds an ADMIN_NAV_ITEMS entry for it — that's how
 * /admin/mastering/bulk shipped unreachable.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ADMIN_NAV_ITEMS, isSidebarVisible } from '@/config/admin-nav';

describe('delivery links nav entry', () => {
  it('registers /admin/deliveries so it appears in the sidebar and palette', () => {
    const entry = ADMIN_NAV_ITEMS.find((item) => item.href === '/admin/deliveries');
    expect(entry).toBeDefined();
    expect(entry?.title).toBe('Delivery links');
    expect(entry?.section).toBe('Library');
    expect(isSidebarVisible(entry!)).toBe(true);
  });

  it('href matches a real page route', () => {
    const entry = ADMIN_NAV_ITEMS.find((item) => item.href === '/admin/deliveries')!;
    const routeFile = join(process.cwd(), 'src/app/(admin)', entry.href, 'page.tsx');
    expect(existsSync(routeFile)).toBe(true);
  });
});

/**
 * The admin names the song source as TamilAgaval Music, Raj's own label — never
 * the tool behind it (2026-10-03). Search keeps the old word so a habit of
 * typing "suno" still finds the page.
 */
describe('the prompts page is named for TamilAgaval Music', () => {
  const entry = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/music-prompts');

  it('lives at /admin/music-prompts, titled TamilAgaval Music Prompts', () => {
    expect(entry?.title).toBe('TamilAgaval Music Prompts');
    expect(existsSync(join(process.cwd(), 'src/app/(admin)/admin/music-prompts/page.tsx'))).toBe(true);
  });

  it('shows no SUNO in any title or subtitle', () => {
    for (const item of ADMIN_NAV_ITEMS) {
      expect(`${item.title} ${(item as { subtitle?: string }).subtitle ?? ''}`).not.toMatch(/suno/i);
    }
  });

  it('can still be found by searching "suno"', () => {
    expect(entry?.keywords).toEqual(expect.arrayContaining(['suno']));
  });

  it('keeps the old address working, as a redirect', () => {
    const old = readFileSync(join(process.cwd(), 'src/app/(admin)/admin/suno-prompts/page.tsx'), 'utf8');
    expect(old).toMatch(/redirect\(['"]\/admin\/music-prompts['"]\)/);
  });
});

describe('Visual Story Studio nav entry', () => {
  const entry = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/visual-story');

  it('is in the sidebar beside the Compose tools and has a real page', () => {
    expect(entry?.title).toBe('Visual Story Studio');
    expect(entry?.section).toBe('Compose');
    expect(isSidebarVisible(entry!)).toBe(true);
    expect(existsSync(join(process.cwd(), 'src/app/(admin)/admin/visual-story/page.tsx'))).toBe(true);
  });
});

describe('Video Text nav entry', () => {
  const entry = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/video-text');

  it('is in the Sound section right after Bulk upload and has a real page', () => {
    expect(entry?.title).toBe('Video Text');
    expect(entry?.section).toBe('Sound');
    expect(isSidebarVisible(entry!)).toBe(true);
    const i = ADMIN_NAV_ITEMS.findIndex((x) => x.href === '/admin/video-text');
    expect(ADMIN_NAV_ITEMS[i - 1]?.href).toBe('/admin/mastering/bulk');
    expect(existsSync(join(process.cwd(), 'src/app/(admin)/admin/video-text/page.tsx'))).toBe(true);
  });
});

describe('Studio listening test', () => {
  const entry = ADMIN_NAV_ITEMS.find((i) => i.href === '/admin/music-lab/studio-test');
  it('is in the Music Lab section of the sidebar and has a real page', () => {
    expect(entry?.title).toBe('Studio listening test');
    expect(entry?.section).toBe('Music Lab');
    expect(isSidebarVisible(entry!)).toBe(true);
    expect(existsSync(join(process.cwd(), 'src/app/(admin)/admin/music-lab/studio-test/page.tsx'))).toBe(true);
  });
});
