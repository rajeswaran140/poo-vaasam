/** @jest-environment node */
/**
 * The Mastering studio's manifest.
 *
 * Almost every way a manifest goes wrong is silent — the browser simply never
 * offers to install, with nothing in the console. These lock the properties
 * that decide installability, plus the two decisions that are easy to "tidy"
 * into a break: the public path and the /admin/ scope.
 */
import manifestModule from '@/app/manifest';
import {
  masteringManifest,
  MASTERING_APP_ID,
  MASTERING_SCOPE,
  MASTERING_START_URL,
  MASTERING_MANIFEST_PATH,
  MASTERING_APPLE_ICON,
} from '@/lib/mastering-manifest';

const m = masteringManifest();

describe('installability requirements', () => {
  it('carries both icon sizes Chrome requires before offering an install', () => {
    const sizes = m.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('ships a maskable icon so Android does not crop the meter', () => {
    const maskable = m.icons.filter((i) => i.purpose === 'maskable');
    expect(maskable).toHaveLength(1);
    expect(maskable[0].sizes).toBe('512x512');
  });

  it('every icon is a PNG under the public /icons path', () => {
    for (const icon of m.icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.src).toMatch(/^\/icons\/mastering-/);
    }
  });

  it('launches standalone with a name and a short name', () => {
    expect(m.display).toBe('standalone');
    expect(m.name.length).toBeGreaterThan(0);
    // Home-screen labels are truncated past ~12 characters.
    expect(m.short_name.length).toBeLessThanOrEqual(12);
  });
});

describe('the two decisions that are easy to break', () => {
  it('is served from a PUBLIC path — anything under /admin 307s to login', () => {
    // Middleware redirects /admin/*, and a manifest is fetched WITHOUT
    // credentials, so an /admin path would resolve to the login HTML and the
    // app would never become installable.
    expect(MASTERING_MANIFEST_PATH).toBe('/mastering.webmanifest');
    expect(MASTERING_MANIFEST_PATH.startsWith('/admin')).toBe(false);
  });

  it('scopes to /admin/ rather than claiming the whole origin', () => {
    expect(MASTERING_SCOPE).toBe('/admin/');
    expect(m.scope).toBe('/admin/');
  });

  it('start_url sits inside scope, or the browser refuses the manifest', () => {
    expect(m.start_url.startsWith(m.scope)).toBe(true);
    expect(MASTERING_START_URL).toBe('/admin/mastering');
  });

  it('pins an explicit id so a later start_url change updates the installed app', () => {
    // Without an id the browser derives one from start_url; changing start_url
    // would then orphan the installed copy rather than update it.
    expect(m.id).toBe(MASTERING_APP_ID);
    expect(m.id.length).toBeGreaterThan(0);
  });
});

describe('coexistence with the public Tamilagaval PWA', () => {
  const site = manifestModule();

  it('does not collide with the site app on id/scope/start_url', () => {
    expect(site.scope).toBe('/');
    expect(m.scope).not.toBe(site.scope);
    expect(m.start_url).not.toBe(site.start_url);
  });

  it('uses its own icons, so two installed apps are tellable apart', () => {
    const siteIcons = (site.icons ?? []).map((i) => i.src);
    for (const icon of m.icons) {
      expect(siteIcons).not.toContain(icon.src);
    }
  });

  it('is named for the tool, not the brand — they sit side by side on a home screen', () => {
    expect(m.name).not.toBe(site.name);
    expect(m.short_name).not.toBe(site.short_name);
  });

  it('has its OWN apple-touch-icon, because iOS never reads manifest icons', () => {
    // Safari pins <link rel="apple-touch-icon">, not the manifest. Inheriting
    // the site's would put two identical icons on an iPhone home screen — the
    // exact place the distinct icon was for.
    expect(MASTERING_APPLE_ICON).toBe('/icons/mastering-apple-180.png');
    expect(MASTERING_APPLE_ICON).not.toMatch(/apple-icon\.png$/);
  });
});
