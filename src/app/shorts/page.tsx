/**
 * /shorts — the full Shorts catalogue.
 *
 * WHY IT EXISTS. Shorts were reachable only as a horizontal rail inside
 * /videos, and /videos is not linked from the home page — so a Short took
 * three unsignposted steps to reach. They are also the channel's best-liked
 * format (20.83 likes per 1,000 views against the songs' 9.97) and, since the
 * 2026-09-19 policy, every song ships with one. A rail that shows three of them
 * was the wrong container.
 *
 * Everything here is Tamilagaval's own: the feed is the channel's uploads, and
 * every embed chains into the channel's Shorts playlist so what plays next is
 * also ours.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { fetchChannelVideos, videosItemListJsonLd, withTruncatedDescriptions } from '@/lib/youtube-feed';
import { SITE, isYouTubeVideosConfigured } from '@/config/site';
import { ShortsGrid } from '@/components/ShortsGrid';
import { partitionShorts } from '@/lib/youtube-shorts';
import { SubscribeButton } from '@/components/SubscribeButton';
import { JsonLd } from '@/components/JsonLd';
import { alternatesFor, breadcrumbJsonLd } from '@/lib/seo';
import Link from 'next/link';

// Per-request, exactly as /videos: Amplify's SSR compute does not persist
// Next's incremental cache across Lambda instances, so a `revalidate` route
// freezes at build time and new uploads never appear.
export const dynamic = 'force-dynamic';

/** The whole catalogue, not a page of it — the point is that nothing is hidden. */
const FEED_LIMIT = 200;

// No brand here: the ROOT layout appends it via `title.template`. With it
// baked in as well, the live tab read "Tamil Shorts by Raj — TamilAgaval |
// Tamilagaval" — twice, in two different spellings.
const META_TITLE = 'Tamil Shorts by Raj';
const META_DESCRIPTION =
  'Every short from the Tamilagaval channel by Raj — original Tamil songs and poetry in under three minutes. Always free.';

export const metadata: Metadata = {
  title: META_TITLE,
  description: META_DESCRIPTION,
  alternates: alternatesFor('/shorts'),
  openGraph: { title: META_TITLE, description: META_DESCRIPTION, url: '/shorts', type: 'website' },
};

export default async function ShortsPage() {
  if (!isYouTubeVideosConfigured()) notFound();

  const all = await fetchChannelVideos(SITE.youtube.channelId, FEED_LIMIT);
  const { shorts } = partitionShorts(all);
  const now = Date.now();

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Tamilagaval', path: '/' },
          { name: 'Shorts', path: '/shorts' },
        ])}
      />
      {shorts.length > 0 && <JsonLd data={videosItemListJsonLd(shorts)} />}
      <Header />
      <main id="main" className="flex min-h-screen flex-col bg-gray-900">
        {/* The header is `fixed` at h-20 (80px), so the top padding here is
           clearance, not decoration: pt-24 left only 16px between the header's
           border and the heading, and pt-20 left none at all. pt-28 = 80px of
           header + 32px of air, matching /karaoke, /contact, /music-composition
           and /privacy. */}
        <section className="border-b border-gray-800 bg-gray-900 pt-28 pb-8">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h1 className="font-tamil text-3xl font-bold text-white sm:text-4xl">
              குறும் காணொளிகள்
            </h1>
            <p className="mt-3 max-w-2xl font-tamil text-gray-300">
              மூன்று நிமிடங்களுக்குள் ஒரு பாடல், ஒரு கவிதை — தமிழகவலின் அனைத்து ஷார்ட்ஸ்.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <SubscribeButton source="shorts_page" />
              <span className="font-tamil text-sm text-gray-400">
                {shorts.length} ஷார்ட்ஸ்
              </span>
              <Link
                href="/videos"
                className="font-tamil text-sm text-orange-400 underline-offset-4 hover:text-orange-300 hover:underline"
              >
                முழுப் பாடல்கள் →
              </Link>
            </div>
          </div>
        </section>

        <section className="flex-1 py-10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <ShortsGrid shorts={withTruncatedDescriptions(shorts)} now={now} />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
