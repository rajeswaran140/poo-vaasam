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
import Image from 'next/image';

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
  // Feature the latest video in the hero once there are enough for a grid below.
  const featured = videos.length >= 3 ? videos[0] : null;
  const galleryVideos = featured ? videos.slice(1) : videos;

  return (
    <>
      {videos.length > 0 && <JsonLd data={videosItemListJsonLd(videos)} />}
      <Header />
      <main className="min-h-screen flex flex-col">
        {/* Full-bleed hero — matches the /songs hero treatment. */}
        <section className="relative w-full overflow-hidden bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_12%_-15%,rgba(255,255,255,0.38),transparent_55%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_90%_at_100%_115%,rgba(255,170,70,0.45),transparent_60%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-gray-900"
          />

          <div className="relative w-full px-6 pb-16 pt-24 sm:px-10 lg:px-16">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 animate-fade-in-up">
                <span className="mb-3 inline-flex items-center rounded-full bg-white/15 px-3 py-1 font-tamil text-xs font-semibold uppercase tracking-wide text-white ring-1 ring-white/25 backdrop-blur-sm">
                  தமிழகவல் · YouTube
                </span>
                <h1 className="mb-2 font-kavivanar text-5xl font-extrabold leading-tight drop-shadow-md sm:text-6xl lg:text-7xl">
                  காணொளிகள்
                </h1>
                <p className="mb-4 max-w-xl font-tamil text-white/90">
                  ரஜேஸ்வரன் தங்கராஜாவின் தமிழ் பாடல்களும் கவிதைகளும் — காணொளி வடிவில்.
                </p>
                <div className="mb-6 flex flex-wrap items-center gap-2 font-tamil text-sm">
                  {videos.length > 0 && (
                    <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-white ring-1 ring-white/20 backdrop-blur-sm">
                      {videos.length} காணொளிகள்
                    </span>
                  )}
                  <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-white ring-1 ring-white/20 backdrop-blur-sm">
                    என்றும் இலவசம்
                  </span>
                </div>
                <SubscribeButton
                  label="YouTube"
                  source="videos_hero"
                  className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 font-tamil text-base font-bold text-orange-700 shadow-xl shadow-black/20 transition-all duration-200 hover:scale-105 hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 active:scale-95"
                />
              </div>

              {/* Featured latest video */}
              {featured && (
                <a
                  href={featured.watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`சமீபத்திய காணொளி: ${featured.title}`}
                  className="group relative block w-full shrink-0 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/25 animate-fade-in lg:w-[28rem]"
                >
                  <Image
                    src={featured.thumbnail}
                    alt={featured.title}
                    width={480}
                    height={360}
                    sizes="(min-width: 1024px) 28rem, 100vw"
                    className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <span aria-hidden className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 ring-2 ring-white/70 transition group-hover:bg-orange-600/90">
                      <svg className="ml-1 h-7 w-7 fill-white text-white" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  </span>
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 pt-10">
                    <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-orange-200">சமீபத்தியது</span>
                    <span className="line-clamp-2 font-tamil text-sm font-medium text-white drop-shadow">{featured.title}</span>
                  </span>
                </a>
              )}
            </div>
          </div>
        </section>

        <div className="container mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <VideoGallery videos={galleryVideos} />

          {videos.length > 0 && (
            <section className="mt-12 text-center">
              <p className="mb-4 font-tamil text-gray-300">
                புதிய காணொளிகளை தவறவிடாமல் பெற, எங்களை சந்தாதாரராக சேருங்கள்.
              </p>
              <SubscribeButton
                label="YouTube"
                source="videos_footer"
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 px-7 py-3.5 font-tamil font-bold text-white shadow-lg transition-opacity hover:opacity-90"
              />
            </section>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
