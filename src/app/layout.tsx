import type { Metadata } from "next";
import { Noto_Sans_Tamil, Kavivanar, Baloo_Thambi_2 } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { MusicPlayerProvider } from "@/components/music/MusicPlayerProvider";
import BackToTop from "@/components/BackToTop";
import { FloatingSubscribe } from "@/components/FloatingSubscribe";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";
import { GA_ID, GOOGLE_SITE_VERIFICATION } from "@/lib/analytics";

const notoSansTamil = Noto_Sans_Tamil({
  subsets: ['tamil'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-tamil',
});

const kavivanar = Kavivanar({
  subsets: ['tamil'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-kavivanar',
});

const balooThambi = Baloo_Thambi_2({
  subsets: ['tamil'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-baloo-thambi',
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tamilagaval.com"),
  // Tamil-script searches barely happen — the SEO posture is romanised English
  // (tamil kavithai / paadal varigal / rajeswaran thangarajah / tamilagaval)
  // even though the visible UI stays Tamil for actual readers.
  title: {
    default: "Tamilagaval — Tamil Poems, Songs & Lyrics by Rajeswaran Thangarajah",
    template: "%s | Tamilagaval",
  },
  description: "Free Tamil poems, songs and YouTube videos by lyricist Rajeswaran Thangarajah. Read tamil kavithai, listen to paadal varigal — always free.",
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
  authors: [{ name: "Rajeswaran Thangarajah" }],
  creator: "Rajeswaran Thangarajah",
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
    title: "Tamilagaval — Tamil Poems, Songs & Lyrics by Rajeswaran Thangarajah",
    description: "Free Tamil poems, songs and YouTube videos by lyricist Rajeswaran Thangarajah. Tamil kavithai, paadal varigal — always free.",
    type: "website",
    locale: "ta_IN",
    siteName: "Tamilagaval",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tamilagaval — Tamil Poems, Songs & Lyrics by Rajeswaran Thangarajah",
    description: "Free Tamil poems, songs and YouTube videos by lyricist Rajeswaran Thangarajah. Tamil kavithai, paadal varigal — always free.",
  },
  // Search Console HTML-tag verification (only emitted when configured).
  ...(GOOGLE_SITE_VERIFICATION ? { verification: { google: GOOGLE_SITE_VERIFICATION } } : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ta" className={`${notoSansTamil.variable} ${kavivanar.variable} ${balooThambi.variable}`}>
      <body className="font-tamil antialiased">
        <AuthProvider>
          <MusicPlayerProvider>
            {children}
            <BackToTop />
            <FloatingSubscribe />
          </MusicPlayerProvider>
        </AuthProvider>
        <GoogleAnalytics gaId={GA_ID} />
      </body>
    </html>
  );
}
