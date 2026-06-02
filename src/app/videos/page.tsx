/**
 * /videos — gallery of the channel's latest YouTube uploads, with a Subscribe
 * CTA in the hero and another below the gallery. Hidden (404) until a channel
 * ID is configured in src/config/site.ts.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { fetchChannelVideos, videosItemListJsonLd, thumbnailVariants } from '@/lib/youtube-feed';
import { SITE, isYouTubeVideosConfigured } from '@/config/site';
import { VideoGallery } from '@/components/VideoGallery';
import { SubscribeButton } from '@/components/SubscribeButton';
import { JsonLd } from '@/components/JsonLd';

// Render per-request rather than as a build-time prerender. Amplify's SSR
// compute does not run Next's time-based ISR revalidation reliably (the
// incremental cache isn't persisted across Lambda instances), so a prerendered
// `revalidate` route freezes at build time and new uploads never appear.
// Dynamic rendering + the in-process feed cache in youtube-feed.ts keeps the
// gallery fresh (within FEED_REVALIDATE_SECONDS) without depending on ISR.
export const dynamic = 'force-dynamic';

// Crawler-facing metadata is romanised English (real queries:
// "rajeswaran thangarajah youtube", "tamil videos"); the visible page heading
// on /videos stays "காணொளிகள்".
const META_TITLE = 'Tamil Videos by Rajeswaran Thangarajah';
const META_DESCRIPTION =
  'Latest videos from the Tamilagaval YouTube channel — Tamil poems, songs and lyrics by Rajeswaran Thangarajah.';

export async function generateMetadata(): Promise<Metadata> {
  // OG image = the latest video's thumbnail (so each share preview reflects
  // current top content). Falls back to a static value if the feed is empty.
  let ogImage = 'https://i.ytimg.com/vi/gfywsN483lI/maxresdefault.jpg';
  if (isYouTubeVideosConfigured()) {
    const videos = await fetchChannelVideos(SITE.youtube.channelId, 1);
    if (videos[0]) ogImage = thumbnailVariants(videos[0].id)[3]; // maxresdefault
  }
  return {
    title: META_TITLE,
    description: META_DESCRIPTION,
    alternates: { canonical: '/videos' },
    openGraph: {
      title: META_TITLE,
      description: META_DESCRIPTION,
      url: '/videos',
      type: 'website',
      images: [{ url: ogImage, width: 1280, height: 720 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: META_TITLE,
      description: META_DESCRIPTION,
      images: [ogImage],
    },
  };
}

export default async function VideosPage() {
  if (!isYouTubeVideosConfigured()) {
    notFound();
  }

  const videos = await fetchChannelVideos(SITE.youtube.channelId, 24);

  return (
    <>
      {videos.length > 0 && <JsonLd data={videosItemListJsonLd(videos)} />}
      <Header />
      <main className="min-h-screen container mx-auto px-4 sm:px-6 py-10 max-w-6xl">
        <section className="mb-10 overflow-hidden rounded-2xl bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white shadow-xl">
          <div className="px-6 py-12 sm:px-12 sm:py-16 text-center">
            <h1 className="text-4xl sm:text-5xl font-bold font-kavivanar mb-2 drop-shadow-lg">
              காணொளிகள்
            </h1>
            <p className="text-white/90 font-tamil text-lg max-w-2xl mx-auto mb-8">
              எங்கள் YouTube சேனலின் சமீபத்திய காணொளிகள்.
            </p>
            <SubscribeButton
              label="YouTube"
              source="videos_hero"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-orange-600 rounded-full font-bold hover:bg-orange-50 transition-colors shadow-lg"
            />
            {videos.length > 0 && (
              <p className="mt-6 text-white/80 font-tamil text-sm">{videos.length} காணொளிகள்</p>
            )}
          </div>
        </section>

        <VideoGallery videos={videos} />

        {videos.length > 0 && (
          <section className="mt-12 text-center">
            <p className="font-tamil text-gray-300 mb-4">
              புதிய காணொளிகளை தவறவிடாமல் பெற, எங்களை சந்தாதாரராக சேருங்கள்.
            </p>
            <SubscribeButton
              label="YouTube"
              source="videos_footer"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white rounded-full font-bold hover:opacity-90 transition-opacity shadow-lg"
            />
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
