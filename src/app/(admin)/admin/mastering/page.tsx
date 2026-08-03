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

import type { Metadata } from 'next';
import { MasteringStudio } from '@/components/admin/MasteringStudio';
import { MasteringInstall } from '@/components/admin/MasteringInstall';
import { MASTERING_MANIFEST_PATH } from '@/lib/mastering-manifest';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mastering — Tamilagaval',
  manifest: MASTERING_MANIFEST_PATH,
  appleWebApp: { capable: true, title: 'Mastering', statusBarStyle: 'black-translucent' },
};

/** Matches the manifest's theme_color so the status bar does not change shade. */
export const viewport = { themeColor: '#ea580c' };

export default function AdminMasteringPage() {
  return (
    <div className="space-y-4">
      <MasteringInstall />
      <MasteringStudio />
    </div>
  );
}
