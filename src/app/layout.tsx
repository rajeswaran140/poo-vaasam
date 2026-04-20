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
  title: "பூ வாசம் - Poo Vaasam",
  description: "Tamil content publishing platform for lyrics, songs, poems, stories, and essays",
  keywords: ["Tamil", "lyrics", "songs", "poems", "stories", "essays", "Tamil literature"],
  authors: [{ name: "Rajeswaran" }],
  openGraph: {
    title: "பூ வாசம் - Poo Vaasam",
    description: "Tamil content publishing platform",
    type: "website",
    locale: "ta_IN",
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
