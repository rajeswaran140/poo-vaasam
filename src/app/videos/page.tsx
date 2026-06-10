/**
 * /videos — gallery of the channel's latest YouTube uploads, with a Subscribe
 * CTA in the hero and another below the gallery. Hidden (404) until a channel
 * ID is configured in src/config/site.ts.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { fetchChannelVideos, videosItemListJsonLd, s3ThumbnailUrl } from '@/lib/youtube-feed';
import { SITE, isYouTubeVideosConfigured } from '@/config/site';
import { VideoGallery } from '@/components/VideoGallery';
import { ShortsRow } from '@/components/ShortsRow';
import { partitionShorts } from '@/lib/youtube-shorts';
import { SubscribeButton } from '@/components/SubscribeButton';
import { JsonLd } from '@/components/JsonLd';
import { alternatesFor } from '@/lib/seo';
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
  // Share image = the latest LONG-FORM video's mirrored thumbnail — the same
  // image the on-page hero uses. This is high-res, region-safe, and 404-safe
  // (we mirror it to S3), unlike the previous `i.ytimg maxresdefault of the
  // latest upload`, which (a) could be a Short's portrait frame in a 16:9 card
  // and (b) 404s for any video that lacks a maxres variant. We partition first
  // so a Short never becomes the share image. Static fallback when the feed is
  // empty/unconfigured. Shares the in-process feed cache with the page render.
  let ogImage = s3ThumbnailUrl('gfywsN483lI');
  if (isYouTubeVideosConfigured()) {
    const all = await fetchChannelVideos(SITE.youtube.channelId, 24);
    const { videos } = partitionShorts(all);
    const lead = videos[0] ?? all[0];
    if (lead) ogImage = lead.thumbnail;
  }
  return {
    title: META_TITLE,
    description: META_DESCRIPTION,
    alternates: alternatesFor('/videos'),
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

  const all = await fetchChannelVideos(SITE.youtube.channelId, 24);
  // Shorts (≤3 min, portrait) are presented in their own row so they don't
  // render letterboxed inside the 16:9 grid alongside the full songs.
  const { shorts, videos } = partitionShorts(all);
  // Feature the latest long-form video in the hero once there are enough for a
  // grid below (a Short doesn't suit the 16:9 hero).
  const featured = videos.length >= 3 ? videos[0] : null;
  const galleryVideos = featured ? videos.slice(1) : videos;

  return (
    <>
      {all.length > 0 && <JsonLd data={videosItemListJsonLd(all)} />}
      <Header />
      <main id="main" className="min-h-screen flex flex-col">
        {/* Full-width hero — two-column grid: CTA + latest video. No background
            gradient; sits on the page's dark base (text stays white). */}
        <section className="relative w-full overflow-hidden text-white">
          <div className="relative w-full px-6 pb-16 pt-24 sm:px-10 lg:px-16">
            <div className="grid w-full items-center gap-8 lg:grid-cols-[5fr_7fr] lg:gap-14">
              {/* Column 1 — CTA */}
              <div className="min-w-0 animate-fade-in-up">
                <span className="mb-3 inline-flex items-center rounded-full bg-white/15 px-3 py-1 font-tamil text-xs font-semibold uppercase tracking-wide text-white ring-1 ring-white/25 backdrop-blur-sm">
                  தமிழகவல் · YouTube
                </span>
                <h1 className="mb-4 font-kavivanar text-5xl font-extrabold leading-tight drop-shadow-md sm:text-6xl lg:text-7xl">
                  காணொளிகள்
                </h1>
                <div className="mb-6 max-w-xl space-y-1.5 font-tamil text-base leading-relaxed text-white/90 sm:text-lg">
                  <p>ஊக்கம்: <span className="font-semibold text-white">தமிழ்</span></p>
                  <p>ஆக்கம்: <span className="font-semibold text-white">தமிழகவல்</span></p>
                  <p>பாடல் வரிகள், கவிதைகள், கதைகள்: <span className="font-semibold text-white">இராஜ்</span></p>
                </div>
                <div className="mb-6 flex flex-wrap items-center gap-2 font-tamil text-sm">
                  {videos.length > 0 && (
                    <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-white ring-1 ring-white/20 backdrop-blur-sm">
                      {videos.length} காணொளிகள்
                    </span>
                  )}
                  {shorts.length > 0 && (
                    <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-white ring-1 ring-white/20 backdrop-blur-sm">
                      {shorts.length} Shorts
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

              {/* Column 2 — latest video (links to YouTube) */}
              {featured && (
                <a
                  href={featured.watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`சமீபத்திய காணொளி: ${featured.title}`}
                  className="group relative block w-full overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/25 animate-fade-in"
                >
                  <Image
                    src={featured.thumbnail}
                    alt={featured.title}
                    width={1280}
                    height={720}
                    priority
                    sizes="(min-width: 1024px) 50vw, 100vw"
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

          {shorts.length > 0 && (
            <section className="mt-12">
              <h2 className="mb-5 font-kavivanar text-3xl text-white">Shorts</h2>
              <ShortsRow shorts={shorts} />
            </section>
          )}

          {all.length > 0 && (
            <section className="mt-12 text-center">
              <p className="mb-4 font-tamil text-gray-300">
                புதிய காணொளிகளை தவறவிடாமல் பெற, எங்களை சந்தாதாரராக சேருங்கள்.
              </p>
              <SubscribeButton
                label="YouTube"
                source="videos_footer"
                className="inline-flex items-center gap-2 rounded-full bg-orange-600 px-7 py-3.5 font-tamil font-bold text-white shadow-lg transition-colors hover:bg-orange-700"
              />
            </section>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
