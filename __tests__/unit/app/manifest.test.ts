/** @jest-environment node */
/**
 * Web App Manifest — guards the installability contract so a future tweak can't
 * silently break "Add to Home Screen" (standalone display, start_url, the
 * 192/512 + maskable icon set browsers require to offer install).
 */

import manifest from '@/app/manifest';

describe('app manifest', () => {
  const m = manifest();

  it('declares an installable, standalone PWA rooted at /', () => {
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/');
    expect(m.scope).toBe('/');
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
  });

  it('sets brand theme + background colours for the splash/OS chrome', () => {
    expect(m.theme_color).toBe('#ea580c');
    expect(m.background_color).toBeTruthy();
  });

  it('ships the 192 + 512 PNG icons and a maskable icon', () => {
    const icons = m.icons ?? [];
    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    // every icon is a real PNG under /icons/
    expect(icons.every((i) => i.type === 'image/png' && String(i.src).startsWith('/icons/'))).toBe(true);
  });

  it('exposes deep-link shortcuts that stay within scope', () => {
    const shortcuts = m.shortcuts ?? [];
    expect(shortcuts.length).toBeGreaterThan(0);
    expect(shortcuts.every((s) => s.url.startsWith('/'))).toBe(true);
  });
});
