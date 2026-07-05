/**
 * Lyrics index — the songs whose lyrics are cleared to show behind the email
 * gate. Built at deploy time (the SSR runtime has no DynamoDB creds), so a newly
 * flagged song appears after the next deploy — consistent with /songs.
 *
 * We list titles + covers and link to /lyrics/<titleSlug>; the lyrics BODY is
 * never rendered here — it's served only after the email gate on the detail page.
 */

export const revalidate = false;

import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { alternatesFor } from '@/lib/seo';
import { listLyricsSongs } from '@/lib/lyrics-content';

export const metadata: Metadata = {
  title: 'பாடல் வரிகள் · Lyrics',
  description:
    'தமிழ் பாடல் வரிகள் தொகுப்பு — இலவசம். ஒரு சிறு பதிவுடன் பாடல் வரிகளைப் படியுங்கள்.',
  alternates: alternatesFor('/lyrics'),
  // The hub links to email-gated lyrics (nothing crawlable behind the gate), so
  // keep the index out of the search index but follow through to the per-song
  // detail pages, which are themselves indexable when live.
  robots: { index: false, follow: true },
};

async function getLyricsSongs() {
  try {
    return await listLyricsSongs();
  } catch (error) {
    console.error('Failed to fetch lyrics songs:', error);
    return [];
  }
}

export default async function LyricsIndexPage() {
  const songs = await getLyricsSongs();

  return (
    <div className="flex min-h-screen flex-col bg-gray-950">
      <Header />
      <main id="main" className="flex-1 pt-20">
        <section className="container mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <h1 className="font-tamil text-3xl font-bold text-white sm:text-4xl">
            📜 பாடல் வரிகள்
          </h1>
          <p className="mt-3 max-w-2xl font-tamil text-gray-400">
            பாடல் வரிகள் இலவசம். ஒரு பாடலைத் தேர்ந்தெடுத்து, உங்கள் பெயரையும்
            மின்னஞ்சலையும் பகிர்ந்தால் வரிகள் உடனே திறக்கும் — புதிய பாடல்களும்
            உங்களை வந்தடையும்.
          </p>

          {songs.length === 0 ? (
            <div className="mt-12 rounded-2xl border border-gray-800 bg-gray-900/50 p-10 text-center">
              <div className="mb-3 text-5xl">📜</div>
              <p className="font-tamil text-gray-400">
                இன்னும் பாடல் வரிகள் இணைக்கப்படவில்லை. விரைவில் வந்துவிடும் —
                பின்னர் பாருங்கள்.
              </p>
            </div>
          ) : (
            <ul className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {songs.map((song) => (
                <li key={song.id}>
                  <Link
                    href={`/lyrics/${song.titleSlug}`}
                    className="group flex h-full flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/60 transition-all hover:border-orange-500/50 hover:bg-gray-900"
                  >
                    {song.featuredImage ? (
                      <div className="relative aspect-video w-full overflow-hidden bg-gray-800">
                        <Image
                          src={song.featuredImage}
                          alt={song.title}
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          className="object-cover transition-transform group-hover:scale-[1.03]"
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-yellow-600/30 to-orange-700/30 text-4xl">
                        🎤
                      </div>
                    )}
                    <div className="flex flex-1 flex-col p-5">
                      <h2 className="font-tamil text-lg font-bold text-white transition-colors group-hover:text-orange-400">
                        {song.title}
                      </h2>
                      <span className="mt-auto pt-4 font-tamil text-sm text-orange-400">
                        பாடல் வரிகளைப் பார்க்க →
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
