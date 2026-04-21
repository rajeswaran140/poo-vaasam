import type { Metadata } from "next";
import { Noto_Sans_Tamil, Kavivanar } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "தமிழகவல் | தமிழ் இலக்கிய தளம்",
  description: "பாடல்கள், கவிதைகள், கதைகள் மற்றும் கட்டுரைகளுக்கான தமிழ் உள்ளடக்க வெளியீட்டு தளம். இலவசமாக தமிழ் இலக்கியங்களை படியுங்கள் மற்றும் கேளுங்கள்.",
  keywords: [
    "தமிழ்",
    "பாடல்கள்",
    "கவிதைகள்",
    "கதைகள்",
    "கட்டுரைகள்",
    "தமிழ் இலக்கியம்",
    "தமிழ் பாடல் வரிகள்",
    "தமிழ் கவிதைகள்",
    "இலவச தமிழ் உள்ளடக்கம்",
  ],
  authors: [{ name: "Rajeswaran" }],
  creator: "தமிழகவல்",
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
  alternates: {
    canonical: "https://tamilagaval.com",
  },
  openGraph: {
    title: "தமிழகவல் | தமிழ் இலக்கிய தளம்",
    description: "இலவசமாக தமிழ் பாடல்கள், கவிதைகள், கதைகள் மற்றும் கட்டுரைகளை படியுங்கள்",
    type: "website",
    locale: "ta_IN",
    siteName: "தமிழகவல்",
  },
  twitter: {
    card: "summary_large_image",
    title: "தமிழகவல் | தமிழ் இலக்கிய தளம்",
    description: "தமிழ் உள்ளடக்க வெளியீட்டு தளம்",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ta" className={`${notoSansTamil.variable} ${kavivanar.variable}`}>
      <body className="font-tamil antialiased">
        {children}
      </body>
    </html>
  );
}
