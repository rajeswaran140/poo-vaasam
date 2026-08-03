/**
 * Web App Manifest for the Mastering studio, as a SECOND installable app on
 * this origin alongside the public Tamilagaval PWA (src/app/manifest.ts).
 *
 * ⚠️ WHY IT IS SERVED FROM A PUBLIC PATH, NOT FROM UNDER /admin.
 * Browsers fetch a manifest with credentials OMITTED unless the link carries
 * `crossorigin="use-credentials"`. Middleware 307s every /admin/* request to
 * /login, so a manifest at /admin/mastering/manifest.webmanifest would resolve
 * to an HTML login page, the parse would fail, and the app would simply never
 * become installable — with no error anywhere. It lives at
 * /mastering.webmanifest, which middleware lets through. Nothing in a manifest
 * is sensitive: it is names, colours and icon paths.
 *
 * ⚠️ SCOPE IS /admin/, WHICH EXCLUDES /login ON PURPOSE.
 * Launching the installed app with an expired session redirects to /login,
 * which is out of scope, so the browser shows it with a minimal in-app URL bar
 * and then hands control back once the redirect returns to /admin/mastering.
 * That one-time bar is the accepted cost of NOT claiming the whole origin —
 * scope '/' would have this admin tool capture every public Tamilagaval link
 * and collide with the main app's scope.
 */

export const MASTERING_MANIFEST_PATH = '/mastering.webmanifest';
export const MASTERING_START_URL = '/admin/mastering';
export const MASTERING_SCOPE = '/admin/';

/**
 * Stable app id. Without an explicit id the browser derives one from start_url,
 * and any later change to start_url would orphan the already-installed app
 * instead of updating it.
 */
export const MASTERING_APP_ID = '/admin/mastering';

export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  start_url: string;
  scope: string;
  display: string;
  orientation: string;
  background_color: string;
  theme_color: string;
  categories: string[];
  icons: { src: string; sizes: string; type: string; purpose: string }[];
}

export function masteringManifest(): WebManifest {
  return {
    id: MASTERING_APP_ID,
    name: 'Tamilagaval Mastering',
    short_name: 'Mastering',
    description:
      'Master a take to a streaming loudness target, trim and fade it, and audition the result.',
    // The admin UI is written in English; the public app is the Tamil one.
    lang: 'en',
    start_url: MASTERING_START_URL,
    scope: MASTERING_SCOPE,
    display: 'standalone',
    // Deliberately unlocked: mastering is done on a laptop as often as a phone,
    // and the waveform is far more useful in landscape.
    orientation: 'any',
    background_color: '#12100e',
    theme_color: '#ea580c',
    categories: ['productivity', 'music'],
    // 192 and 512 are the two Chrome requires before it will offer an install.
    // The maskable copy keeps the meter inside the safe circle so Android does
    // not crop the bars when it applies its own mask.
    icons: [
      { src: '/icons/mastering-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/mastering-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/mastering-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
