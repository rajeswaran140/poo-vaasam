/**
 * /videos — gallery of the channel's latest YouTube uploads, with a Subscribe
 * CTA. Hidden (404) until a channel ID is configured in src/config/site.ts.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import { fetchChannelVideos, videosItemListJsonLd } from '@/lib/youtube-feed';
import { SITE, isYouTubeVideosConfigured } from '@/config/site';
import { VideoGallery } from '@/components/VideoGallery';
import { SubscribeButton } from '@/components/SubscribeButton';
import { JsonLd } from '@/components/JsonLd';

export const revalidate = 300; // 5 minutes — so channel deletions propagate quickly

// Crawler-facing metadata is romanised English (real queries:
// "rajeswaran thangarajah youtube", "tamil videos"); the visible page heading
// on /videos stays "காணொளிகள்".
const META_TITLE = 'Tamil Videos by Rajeswaran Thangarajah';
const META_DESCRIPTION =
  'Latest videos from the Tamilagaval YouTube channel — Tamil poems, songs and lyrics by Rajeswaran Thangarajah.';

export const metadata: Metadata = {
  title: META_TITLE,
  description: META_DESCRIPTION,
  alternates: { canonical: '/videos' },
  openGraph: {
    title: META_TITLE,
    description: META_DESCRIPTION,
    url: '/videos',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: META_TITLE,
    description: META_DESCRIPTION,
  },
};

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
      </main>
    </>
  );
}
