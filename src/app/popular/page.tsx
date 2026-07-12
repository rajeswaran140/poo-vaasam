/**
 * /popular — a shareable landing page for the most-loved (top-5-by-views) songs.
 * Its own SEO page (ItemList schema) and a link you can drop in WhatsApp /
 * community posts. Same curated FEATURED_SONGS as the homepage rail.
 */

import type { Metadata } from 'next';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { JsonLd } from '@/components/JsonLd';
import { FeaturedSongs } from '@/components/FeaturedSongs';
import { SubscribeButton } from '@/components/SubscribeButton';
import { WhatsAppShareButton } from '@/components/content/WhatsAppShareButton';
import { isYouTubeChannelConfigured } from '@/config/site';
import { SITE_URL, alternatesFor } from '@/lib/seo';
import { FEATURED_SONGS, featuredWatchUrl } from '@/config/featured-songs';

export const metadata: Metadata = {
  title: 'மிகவும் விரும்பப்பட்ட தமிழ் பாடல்கள் | Most-Loved Tamil Songs',
  description:
    'Tamilagaval-இன் மிகவும் விரும்பப்பட்ட தமிழ் பாடல்கள் — original Tamil songs written by Rajeswaran Thangarajah. Watch, listen and share — always free.',
  alternates: alternatesFor('/popular'),
};

const itemListJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Most-Loved Tamil Songs — Tamilagaval',
  itemListOrder: 'https://schema.org/ItemListOrderDescending',
  numberOfItems: FEATURED_SONGS.length,
  itemListElement: FEATURED_SONGS.map((song, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    url: featuredWatchUrl(song.videoId),
    name: song.title,
  })),
};

export default function PopularPage() {
  return (
    <div className="min-h-screen bg-gray-900">
      <JsonLd data={itemListJsonLd} />
      <Header />

      <section className="bg-orange-600 pt-24 pb-12 text-white">
        <div className="container mx-auto px-4 text-center">
          <h1 className="font-tamil text-4xl font-extrabold leading-tight sm:text-5xl">மிகவும் விரும்பப்பட்ட பாடல்கள்</h1>
          <p className="mt-3 font-poem text-lg text-white/90">Most-loved Tamil songs — always free</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <WhatsAppShareButton
              url={`${SITE_URL}/popular`}
              title="மிகவும் விரும்பப்பட்ட தமிழ் பாடல்கள் — Tamilagaval"
              verb="listen"
              className="bg-white/15 hover:bg-white/25 border-white/30"
            />
            {isYouTubeChannelConfigured() && (
              <SubscribeButton
                label="YouTube-ல் Subscribe செய்யுங்கள்"
                source="popular_hero"
                className="inline-flex items-center gap-2 rounded-full bg-orange-800 px-6 py-3 font-tamil font-bold text-white shadow-lg transition-all hover:bg-orange-900"
              />
            )}
          </div>
        </div>
      </section>

      <FeaturedSongs heading="அதிகம் கேட்கப்பட்ட 5 பாடல்கள்" />

      <Footer />
    </div>
  );
}
