/**
 * /admin/mastering — the Sound Engineering & Mastering module. Thin server
 * shell; all interaction lives in the client <MasteringStudio>, which talks to
 * /api/admin/mastering/{upload,download} and the existing async master job
 * (/api/admin/music-lab/master).
 *
 * This page is also an INSTALLABLE PWA in its own right, separate from the
 * public Tamilagaval app. The `manifest` below overrides the site manifest the
 * root layout injects — without the override an installed copy would launch at
 * the public home page instead of the studio. See lib/mastering-manifest.ts for
 * why that manifest is served from a public path rather than under /admin.
 */

import type { Metadata, Viewport } from 'next';
import { MasteringStudio } from '@/components/admin/MasteringStudio';
import { MasteringInstall } from '@/components/admin/MasteringInstall';
import {
  MASTERING_MANIFEST_PATH,
  MASTERING_APPLE_ICON,
  masteringManifest,
} from '@/lib/mastering-manifest';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mastering — Tamilagaval',
  manifest: MASTERING_MANIFEST_PATH,
  // ⚠️ iOS IGNORES THE MANIFEST'S ICONS and uses apple-touch-icon for the home
  // screen. The root layout supplies one via the app/apple-icon.png convention,
  // so without this override an iPhone would pin the SITE's icon — leaving two
  // visually identical apps on the home screen, which is the one place the
  // distinct icon actually mattered.
  icons: { apple: [{ url: MASTERING_APPLE_ICON, sizes: '180x180', type: 'image/png' }] },
  appleWebApp: {
    capable: true,
    title: 'Mastering',
    // NOT 'black-translucent'. That draws the page UNDER the status bar, and
    // nothing in the admin tree pads for env(safe-area-inset-top) — the sticky
    // admin header would sit beneath the clock and battery on an iPhone.
    statusBarStyle: 'default',
  },
};

/** Read from the manifest so the status bar and the splash can never drift apart. */
export const viewport: Viewport = { themeColor: masteringManifest().theme_color };

export default function AdminMasteringPage() {
  return (
    <div className="space-y-4">
      <MasteringInstall />
      <MasteringStudio />
    </div>
  );
}
