/**
 * Lyrics detail — /lyrics/<titleSlug>.
 *
 * The song title + cover render server-side (resolved by slug via GSI5), but the
 * lyrics BODY is deliberately NOT in the HTML: it's served only through the
 * email gate by the client <LyricsGate>, which calls GET /api/lyrics/<id>. So a
 * crawler or a "view source" never sees the lyrics — they're gated end to end.
 */

import type { Metadata } from 'next';
import { cache } from 'react';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { LyricsGate } from '@/components/LyricsGate';
import { alternatesFor, crawlerAuthor } from '@/lib/seo';
import { getRawSongBySlug, listLyricsSongs, lyricsVisible, LYRICS_VANITY } from '@/lib/lyrics-content';

// Build-time prerender (SSR runtime has no DynamoDB creds); allow on-demand
// resolution of newly flagged songs via dynamicParams.
export const revalidate = false;
export const dynamicParams = true;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  try {
    const songs = await listLyricsSongs();
    return [
      ...songs.filter((s) => !!s.titleSlug).map((s) => ({ slug: s.titleSlug as string })),
      // Share-friendly ASCII aliases (e.g. /lyrics/thayagam).
      ...Object.keys(LYRICS_VANITY).map((slug) => ({ slug })),
    ];
  } catch (error) {
    console.error('generateStaticParams (lyrics) failed:', error);
    return [];
  }
}

// Dedupe the slug read shared by generateMetadata and the page render.
const getSong = cache(async (slug: string) => {
  try {
    return await getRawSongBySlug(decodeURIComponent(slug));
  } catch (error) {
    console.error('Failed to resolve lyrics song by slug:', error);
    return null;
  }
});

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const song = await getSong(slug);
  if (!lyricsVisible(song)) {
    return { title: 'பாடல் வரிகள் கிடைக்கவில்லை', robots: { index: false, follow: true } };
  }
  const title = `${song!.title} — பாடல் வரிகள் · Tamil Lyrics`;
  return {
    title,
    description: `"${song!.title}" — Tamil song lyrics by ${crawlerAuthor()}. Free to read on Tamilagaval.`,
    alternates: alternatesFor(`/lyrics/${slug}`),
    // The detail page is a content-less email gate (lyrics are never in the HTML),
    // and the same song is reachable via both its Tamil titleSlug and an ASCII
    // vanity alias. Keep these thin/duplicate gate URLs out of the index (follow
    // through to the reachable pages), consistent with the /lyrics hub.
    robots: { index: false, follow: true },
  };
}

export default async function LyricsDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const song = await getSong(slug);

  if (!lyricsVisible(song)) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-950">
      <Header />
      <main id="main" className="flex-1 pt-20">
        <article className="container mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
          {song!.featuredImage && (
            <div className="relative mx-auto mb-6 aspect-video w-full max-w-xl overflow-hidden rounded-2xl bg-gray-800">
              <Image
                src={song!.featuredImage}
                alt={song!.title}
                fill
                priority
                sizes="(max-width: 640px) 100vw, 576px"
                className="object-cover"
              />
            </div>
          )}

          <p className="text-center font-tamil text-xs font-semibold uppercase tracking-[0.2em] text-orange-500">
            பாடல் வரிகள் · Tamil Lyrics
          </p>
          <h1 className="mt-2 text-center font-tamil text-3xl font-bold text-white sm:text-4xl">
            {song!.title}
          </h1>

          <div className="mt-8">
            <LyricsGate songId={song!.id} songTitle={song!.title} />
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}
