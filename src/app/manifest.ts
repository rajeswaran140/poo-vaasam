import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — makes Tamilagaval installable to the home screen and
 * launchable standalone (no browser chrome), so on a phone it behaves like the
 * music app it is. Next serves this at /manifest.webmanifest and injects the
 * <link rel="manifest"> automatically.
 *
 * Pairs with the Media Session controls (lock-screen playback) to deliver an
 * app-grade listening experience on the web today — the cheap interim ahead of
 * the native Expo app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'தமிழகவல் — Tamilagaval',
    short_name: 'தமிழகவல்',
    description:
      'Free Tamil poems, songs and lyrics by Rajeswaran Thangarajah — listen, read, share.',
    lang: 'ta',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Dark canvas behind the splash; brand orange for the OS theme/status bar.
    background_color: '#0a0a0a',
    theme_color: '#ea580c',
    categories: ['music', 'entertainment', 'education'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'பாடல்கள் (Songs)', short_name: 'Songs', url: '/songs' },
      { name: 'கவிதைகள் (Poems)', short_name: 'Poems', url: '/poems' },
    ],
  };
}
