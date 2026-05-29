import type { Metadata } from "next";
import { Noto_Sans_Tamil, Kavivanar, Baloo_Thambi_2 } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { MusicPlayerProvider } from "@/components/music/MusicPlayerProvider";
import BackToTop from "@/components/BackToTop";
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
  title: {
    default: "தமிழகவல் | தமிழ் கவிதைகள் & பாடல்கள்",
    template: "%s | தமிழகவல்",
  },
  description: "ரஜேஸ்வரன் தங்கராஜாவின் தமிழ் கவிதைகள், பாடல்கள் மற்றும் காணொளிகள் — இலவசமாகப் படியுங்கள், கேளுங்கள், பாருங்கள்.",
  keywords: [
    "தமிழ்",
    "தமிழ் கவிதைகள்",
    "தமிழ் பாடல்கள்",
    "கவிதைகள்",
    "பாடல்கள்",
    "தமிழ் பாடல் வரிகள்",
    "ரஜேஸ்வரன் தங்கராஜா",
    "இலவச தமிழ் கவிதைகள்",
  ],
  authors: [{ name: "Rajeswaran Thangarajah" }],
  creator: "ரஜேஸ்வரன் தங்கராஜா",
  publisher: "தமிழகவல்",
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
    title: "தமிழகவல் | தமிழ் கவிதைகள் & பாடல்கள்",
    description: "தமிழ் கவிதைகளும் பாடல்களும் — படியுங்கள், கேளுங்கள். என்றும் இலவசம்.",
    type: "website",
    locale: "ta_IN",
    siteName: "தமிழகவல்",
  },
  twitter: {
    card: "summary_large_image",
    title: "தமிழகவல் | தமிழ் கவிதைகள் & பாடல்கள்",
    description: "தமிழ் கவிதைகளும் பாடல்களும் — படியுங்கள், கேளுங்கள். என்றும் இலவசம்.",
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
          </MusicPlayerProvider>
        </AuthProvider>
        <GoogleAnalytics gaId={GA_ID} />
      </body>
    </html>
  );
}
