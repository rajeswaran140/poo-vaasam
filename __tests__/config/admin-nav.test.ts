/**
 * Guards that admin pages are actually reachable through the sidebar.
 *
 * admin-nav.ts is the single source of truth for both the sidebar and the
 * command palette. A page can exist under src/app/(admin)/ and still be
 * unreachable if nobody adds an ADMIN_NAV_ITEMS entry for it — that's how
 * /admin/mastering/bulk shipped unreachable.
 */
import { existsSync } from 'fs';
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
