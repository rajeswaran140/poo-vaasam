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

export const revalidate = 1800; // 30 minutes

const PAGE_TITLE = 'காணொளிகள் — தமிழகவல்';
const PAGE_DESCRIPTION =
  'தமிழகவல் YouTube சேனலின் சமீபத்திய காணொளிகள் — பாருங்கள், சந்தா செலுத்துங்கள்.';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/videos' },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: '/videos',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
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
      <main className="container mx-auto px-4 sm:px-6 py-10 max-w-6xl">
        <section className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold font-kavivanar text-gray-900 mb-3">
            காணொளிகள்
          </h1>
          <p className="text-gray-600 font-tamil mb-6 max-w-2xl mx-auto">
            எங்கள் YouTube சேனலின் சமீபத்திய காணொளிகளை இங்கே பாருங்கள் — பிடித்திருந்தால் சந்தா செலுத்துங்கள்!
          </p>
          <SubscribeButton label="YouTube-ல் சந்தா செலுத்துங்கள்" />
        </section>

        <VideoGallery videos={videos} />
      </main>
    </>
  );
}
