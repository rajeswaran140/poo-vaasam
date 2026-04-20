import type { Metadata } from "next";
import { Noto_Sans_Tamil } from "next/font/google";
import "./globals.css";

const notoSansTamil = Noto_Sans_Tamil({
  subsets: ['tamil'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-tamil',
});

export const metadata: Metadata = {
  title: "பூ வாசம் | தமிழ் இலக்கிய தளம்",
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
  creator: "பூ வாசம்",
  publisher: "பூ வாசம்",
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
    canonical: "https://poo-vaasam.com",
  },
  openGraph: {
    title: "பூ வாசம் | தமிழ் இலக்கிய தளம்",
    description: "இலவசமாக தமிழ் பாடல்கள், கவிதைகள், கதைகள் மற்றும் கட்டுரைகளை படியுங்கள்",
    type: "website",
    locale: "ta_IN",
    siteName: "பூ வாசம்",
  },
  twitter: {
    card: "summary_large_image",
    title: "பூ வாசம் | தமிழ் இலக்கிய தளம்",
    description: "தமிழ் உள்ளடக்க வெளியீட்டு தளம்",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ta" className={notoSansTamil.variable}>
      <body className="font-tamil antialiased">
        {children}
      </body>
    </html>
  );
}
