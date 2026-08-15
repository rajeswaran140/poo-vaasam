import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { MusicPlayerProvider } from "@/components/music/MusicPlayerProvider";
import BackToTop from "@/components/BackToTop";
import { FloatingSubscribe } from "@/components/FloatingSubscribe";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";
import { InboundTracker } from "@/components/analytics/InboundTracker";
import { GA_ID, GOOGLE_SITE_VERIFICATION } from "@/lib/analytics";

/**
 * ⚠️ SELF-HOSTED ON PURPOSE — do not "simplify" this back to `next/font/google`.
 *
 * `next/font/google` downloads the font files from fonts.gstatic.com AT BUILD
 * TIME. When CodeBuild cannot reach it the loader receives null and the whole
 * build dies with `TypeError: Cannot read properties of null (reading '1')` in
 * next-font-loader — a failure that names `layout.tsx` and has nothing to do
 * with the code. It took down Amplify jobs 553 and 558 on 2026-08-14 alone
 * (2 of 8 builds), each costing a manual retry.
 *
 * The .woff2 files now come from the `@fontsource/*` npm packages, which the
 * build already installs, so a deploy no longer depends on Google being
 * reachable. These are the SAME files Google serves — Fontsource repackages
 * the upstream Google Fonts releases.
 *
 * Kept deliberately identical to the previous configuration so nothing about
 * the rendering changes: same three families, same weights, the `tamil` subset
 * only, `display: swap`, and the same CSS variable names.
 *
 * ⚠️ The paths must be written out as LITERALS. `next/font` parses this file
 * statically and rejects any computed value — a shared path constant or a
 * `.map()` over the weights fails the build with "Font loader values must be
 * explicitly written literals", so the repetition below is required.
 */
const notoSansTamil = localFont({
  src: [
    { path: '../../node_modules/@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../node_modules/@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../node_modules/@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../../node_modules/@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-tamil',
});

const kavivanar = localFont({
  src: [
    { path: '../../node_modules/@fontsource/kavivanar/files/kavivanar-tamil-400-normal.woff2', weight: '400', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-kavivanar',
});

const balooThambi = localFont({
  src: [
    { path: '../../node_modules/@fontsource/baloo-thambi-2/files/baloo-thambi-2-tamil-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../node_modules/@fontsource/baloo-thambi-2/files/baloo-thambi-2-tamil-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../node_modules/@fontsource/baloo-thambi-2/files/baloo-thambi-2-tamil-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../../node_modules/@fontsource/baloo-thambi-2/files/baloo-thambi-2-tamil-700-normal.woff2', weight: '700', style: 'normal' },
    { path: '../../node_modules/@fontsource/baloo-thambi-2/files/baloo-thambi-2-tamil-800-normal.woff2', weight: '800', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-baloo-thambi',
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tamilagaval.com"),
  // Tamil-script searches barely happen — the SEO posture is romanised English
  // (tamil kavithai / paadal varigal / rajeswaran thangarajah / tamilagaval)
  // even though the visible UI stays Tamil for actual readers.
  title: {
    default: "Tamilagaval — Tamil Poems, Songs & Lyrics by Raj",
    template: "%s | Tamilagaval",
  },
  description: "Free Tamil poems, songs and YouTube videos by lyricist Raj. Read tamil kavithai, listen to paadal varigal — always free.",
  keywords: [
    "tamil kavithai",
    "tamil paadal",
    "tamil paadal varigal",
    "tamil songs",
    "tamil poems",
    "tamil lyrics",
    "kavithai lyrics",
    "rajeswaran thangarajah",
    "tamilagaval",
    "free tamil poetry",
    "tamil songs free",
    "tamil song lyrics",
  ],
  authors: [{ name: "Raj" }],
  creator: "Raj",
  publisher: "Tamilagaval",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    title: "Tamilagaval — Tamil Poems, Songs & Lyrics by Raj",
    description: "Free Tamil poems, songs and YouTube videos by lyricist Raj. Tamil kavithai, paadal varigal — always free.",
    type: "website",
    locale: "ta_IN",
    siteName: "Tamilagaval",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tamilagaval — Tamil Poems, Songs & Lyrics by Raj",
    description: "Free Tamil poems, songs and YouTube videos by lyricist Raj. Tamil kavithai, paadal varigal — always free.",
  },
  // Installed-PWA presentation on iOS (standalone launch, dark status bar).
  appleWebApp: {
    capable: true,
    title: "தமிழகவல்",
    statusBarStyle: "black-translucent",
  },
  // Search Console HTML-tag verification (only emitted when configured).
  ...(GOOGLE_SITE_VERIFICATION ? { verification: { google: GOOGLE_SITE_VERIFICATION } } : {}),
};

export const viewport: Viewport = {
  // Brand orange tints the mobile browser/OS chrome and the PWA status bar.
  themeColor: "#ea580c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ta" className={`${notoSansTamil.variable} ${kavivanar.variable} ${balooThambi.variable}`}>
      <head>
        {/* Warm the TLS connection to the media CDN and YouTube thumbnail host
            so the first audio/thumbnail byte arrives sooner on high-latency
            rural IN/LK connections (the diaspora's home-region audience). */}
        <link rel="preconnect" href="https://d2cdoh43143xxa.cloudfront.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://i.ytimg.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://d2cdoh43143xxa.cloudfront.net" />
        <link rel="dns-prefetch" href="https://i.ytimg.com" />
      </head>
      <body className="font-tamil antialiased">
        <AuthProvider>
          <MusicPlayerProvider>
            <InstallPrompt />
            {children}
            <BackToTop />
            <FloatingSubscribe />
          </MusicPlayerProvider>
        </AuthProvider>
        <GoogleAnalytics gaId={GA_ID} />
        <InboundTracker />
      </body>
    </html>
  );
}
