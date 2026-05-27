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
        <section className="mb-10 overflow-hidden rounded-2xl bg-gradient-to-br from-red-600 via-red-700 to-orange-700 text-white shadow-xl">
          <div className="px-6 py-12 sm:px-12 sm:py-16 text-center">
            <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm px-4 py-1.5 rounded-full border border-white/25 mb-5">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              <span className="font-tamil text-sm font-semibold">{SITE.youtube.channelLabel}</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold font-kavivanar mb-4 drop-shadow-lg">
              காணொளிகள்
            </h1>
            <p className="text-white/90 font-tamil text-lg max-w-2xl mx-auto mb-8">
              எங்கள் YouTube சேனலின் சமீபத்திய காணொளிகள்.
            </p>
            <SubscribeButton
              label="YouTube-ல் சந்தா செலுத்துங்கள்"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-red-700 rounded-full font-bold hover:bg-red-50 transition-colors shadow-lg"
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
