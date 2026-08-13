/**
 * முகப்பு பக்கம் - பொது
 * தமிழ் உள்ளடக்கத்துடன் அம்சமான தரவு பக்கம்
 */

export const revalidate = 300;

import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { isYouTubeChannelConfigured, socialProfileUrls } from '@/config/site';
import { LatestVideos } from '@/components/LatestVideos';
import { FeaturedSongs } from '@/components/FeaturedSongs';
import { SubscribeButton } from '@/components/SubscribeButton';
import { JsonLd } from '@/components/JsonLd';
import { featuredSongsItemListJsonLd } from '@/config/featured-songs';
import { SITE_URL, SITE_NAME, alternatesFor } from '@/lib/seo';

export const metadata: Metadata = {
  alternates: alternatesFor('/'),
  description: 'Free Tamil poems, songs and YouTube videos by lyricist Raj. Read tamil kavithai, listen to paadal varigal — always free.',
};

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: 'ta',
  description: 'Free Tamil poems, songs and YouTube videos by lyricist Raj — tamil kavithai, paadal varigal, always free.',
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/ai-search?q={search_term_string}` },
    'query-input': 'required name=search_term_string',
  },
};

// The site is one creator's body of work, so advertise the author (Person)
// with links to their channels — helps Google connect the site to the creator.
// YouTube + Facebook + Instagram (each only when configured) — one source of
// truth so /, /about and the footer always agree.
const personSameAs = socialProfileUrls();

const personJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Raj',
  alternateName: 'இராஜ்',
  url: SITE_URL,
  jobTitle: 'Tamil poet and lyricist',
  description: 'Tamil writer and lyricist publishing original poems, songs and videos at tamilagaval.com',
  ...(personSameAs.length > 0 ? { sameAs: personSameAs } : {}),
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-900">
      <JsonLd data={websiteJsonLd} />
      <JsonLd data={personJsonLd} />
      {/* The five songs on this page were unmarked-up while /videos carried 90
          VideoObjects — backwards, since this is the page that gets the traffic. */}
      <JsonLd data={featuredSongsItemListJsonLd()} />
      {/* WCAG 2.4.1 (Level A): a keyboard user had no way past the header nav.
          Visually hidden until focused. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:font-tamil focus:text-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-400"
      >
        உள்ளடக்கத்திற்குச் செல்லவும்
      </a>
      <Header />

      <main id="main">
      {/* Hero Section - Centered */}
      <section className="relative overflow-hidden bg-orange-600 text-white pt-20">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
            backgroundSize: '40px 40px'
          }}></div>
        </div>

        {/* Centered Content Container */}
        <div className="relative z-10">
          <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center">
            {/* Centered CTA Content */}
            <div className="flex items-center justify-center px-6 sm:px-12 lg:px-16 xl:px-24 py-16 lg:py-24">
              <div className="max-w-4xl space-y-10 text-center">
                {/* Free Badge */}
                <div className="inline-flex items-center gap-2.5 bg-white/20 backdrop-blur-md px-6 py-3 rounded-full border border-white/30 shadow-lg">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <span className="font-bold font-tamil">முற்றிலும் இலவசம்</span>
                </div>

                {/* Main Headline - Optimized Typography with Baloo Thambi 2 */}
                <div className="space-y-8">
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-extrabold font-poem leading-tight tracking-normal">
                    <span className="block mb-3 text-white drop-shadow-2xl">படியுங்கள். கேளுங்கள்.</span>
                    <span className="block text-yellow-300">
                      அனுபவித்து மகிழுங்கள்.
                    </span>
                  </h1>
                  <p className="text-lg sm:text-xl lg:text-2xl text-white/95 font-poem leading-relaxed font-light max-w-3xl mx-auto">
                    <span className="block">தமிழ் கவிதைகளும் பாடல்களும்.</span>
                    <span className="block mt-2">என்றும் இலவசம்.</span>
                  </p>
                  <p lang="en" className="text-base sm:text-lg italic text-white/85">Where Tamil Poetry Becomes Song</p>
                </div>

                {/* Feature Pills - Consistent Sizing */}
                <div className="flex flex-wrap gap-3 sm:gap-4 justify-center items-center">
                  <div className="flex items-center gap-3 bg-white/15 backdrop-blur-sm rounded-xl px-5 sm:px-6 py-3 sm:py-3.5 border border-white/20 shadow-lg">
                    <span className="text-2xl" aria-hidden="true">📖</span>
                    <span className="font-semibold font-tamil text-base">வாசிப்பு</span>
                  </div>
                  <div className="flex items-center gap-3 bg-white/15 backdrop-blur-sm rounded-xl px-5 sm:px-6 py-3 sm:py-3.5 border border-white/20 shadow-lg">
                    <span className="text-2xl" aria-hidden="true">🎧</span>
                    <span className="font-semibold font-tamil text-base">கேட்டல்</span>
                  </div>
                  <div className="flex items-center gap-3 bg-white/15 backdrop-blur-sm rounded-xl px-5 sm:px-6 py-3 sm:py-3.5 border border-white/20 shadow-lg">
                    <span className="text-2xl" aria-hidden="true">🚫</span>
                    <span className="font-semibold font-tamil text-base">இத்தளத்தில் விளம்பரம் இல்லை</span>
                  </div>
                </div>

                {/* CTA Buttons - Centered */}
                <div className="flex flex-col sm:flex-row gap-4 pt-6 justify-center">
                  <Link
                    href="/songs"
                    aria-label="இப்போதே தொடங்குங்கள் — பாடல்கள் பக்கம்"
                    className="group px-10 py-5 bg-white text-orange-600 rounded-full font-bold hover:bg-orange-50 transition-all shadow-2xl transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70 font-tamil inline-flex items-center justify-center gap-3 text-lg"
                  >
                    <span className="text-2xl" aria-hidden="true">🎵</span>
                    <span>இப்போதே தொடங்குங்கள்</span>
                    <svg className="w-6 h-6 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </Link>
                  {isYouTubeChannelConfigured() && (
                    <SubscribeButton
                      label="YouTube-ல் Subscribe செய்யுங்கள்"
                      source="home_hero"
                      className="px-10 py-5 bg-orange-700 text-white rounded-full font-bold hover:bg-orange-800 transition-all shadow-2xl transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50 font-tamil inline-flex items-center justify-center gap-3 text-lg"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Most-loved songs — the proven top-5 up front, driving watch→subscribe
          and WhatsApp shares. Curated (see config/featured-songs), links to /popular. */}
      <FeaturedSongs showAllLink />

      {/* Latest YouTube videos — funnel to the channel. Client island so the
          landing page stays static while the feed stays fresh (see LatestVideos). */}
      <LatestVideos />

      {/* Why Choose Section - Free Features */}
      <section className="bg-gray-900 py-20">
        <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 font-tamil leading-snug">
              ஏன் தமிழகவல்?
            </h2>
            <p className="text-lg sm:text-xl text-gray-300 font-tamil max-w-2xl mx-auto leading-relaxed">
              முற்றிலும் இலவசமாக தமிழ் கவிதைகளையும் பாடல்களையும் படியுங்கள், கேளுங்கள், அனுபவியுங்கள்
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 sm:gap-8 mb-12">
            {/* Feature 1: Free Reading */}
            <div className="text-center p-8 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm transition-all hover:bg-white/[0.07] hover:border-white/20 hover:-translate-y-1">
              <div className="w-20 h-20 bg-blue-500/90 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg ring-1 ring-white/10">
                <span className="text-4xl" aria-hidden="true">📖</span>
              </div>
              <h3 className="text-xl font-bold text-white mb-4 font-tamil leading-snug">
                வரம்பற்ற வாசிப்பு
              </h3>
              <p className="text-base text-gray-300 font-tamil leading-loose">
                எல்லா உள்ளடக்கங்களையும் இலவசமாக படியுங்கள். எந்த வரம்பும் இல்லை, எந்த கட்டணமும் இல்லை.
              </p>
            </div>

            {/* Feature 2: Free Audio */}
            <div className="text-center p-8 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm transition-all hover:bg-white/[0.07] hover:border-white/20 hover:-translate-y-1">
              <div className="w-20 h-20 bg-orange-500/90 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg ring-1 ring-white/10">
                <span className="text-4xl" aria-hidden="true">🎧</span>
              </div>
              <h3 className="text-xl font-bold text-white mb-4 font-tamil leading-snug">
                கேளுங்கள் & பாருங்கள்
              </h3>
              <p className="text-base text-gray-300 font-tamil leading-loose">
                பாடல்களை YouTube-ல் முழுமையாக அனுபவியுங்கள்; கவிதைகளை ஒலி வடிவில் கேளுங்கள். இலவசம்.
              </p>
            </div>

            {/* Feature 3: No Ads */}
            <div className="text-center p-8 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm transition-all hover:bg-white/[0.07] hover:border-white/20 hover:-translate-y-1">
              <div className="w-20 h-20 bg-green-500/90 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg ring-1 ring-white/10">
                <span className="text-4xl" aria-hidden="true">✨</span>
              </div>
              <h3 className="text-xl font-bold text-white mb-4 font-tamil leading-snug">
                இத்தளத்தில் விளம்பரம் இல்லை
              </h3>
              <p className="text-base text-gray-300 font-tamil leading-loose">
                இந்தத் தளத்தில் தடையற்ற வாசிப்பு அனுபவம். விளம்பரங்கள் இல்லாமல், உங்கள் வாசிப்பில் கவனம் செலுத்துங்கள்.
              </p>
            </div>
          </div>

          {/* Additional Benefits */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 md:p-12 backdrop-blur-sm">
            <div className="grid md:grid-cols-2 gap-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center flex-shrink-0 ring-1 ring-white/10">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-white mb-2 font-tamil text-base leading-normal">எந்த பதிவும் தேவையில்லை</h4>
                  <p className="text-gray-300 font-tamil leading-relaxed">உடனடியாக படிக்க ஆரம்பியுங்கள்</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-pink-500 rounded-full flex items-center justify-center flex-shrink-0 ring-1 ring-white/10">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-white mb-2 font-tamil text-base leading-normal">மொபைல் நட்பு</h4>
                  <p className="text-gray-300 font-tamil leading-relaxed">எந்த சாதனத்திலும் படிக்கவும் கேட்கவும்</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 ring-1 ring-white/10">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-white mb-2 font-tamil text-base leading-normal">சொந்தப் படைப்புகள்</h4>
                  <p className="text-gray-300 font-tamil leading-relaxed">இராஜின் சொந்தக் கவிதைகளும் பாடல்களும்</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center flex-shrink-0 ring-1 ring-white/10">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-white mb-2 font-tamil text-base leading-normal">தொடர்ச்சியான புதுப்பிப்புகள்</h4>
                  <p className="text-gray-300 font-tamil leading-relaxed">வாரம்தோறும் புதிய உள்ளடக்கம்</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* Music Composition Service */}
      <section className="bg-gradient-to-r from-purple-600 to-purple-800 py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center text-white">
            <div className="text-5xl mb-4" aria-hidden="true">🎼</div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 font-tamil">இசையமைப்பு சேவை</h2>
            <p className="text-lg text-purple-100 font-tamil mb-8 max-w-2xl mx-auto leading-relaxed">
              உங்கள் பாடல் வரிகளுக்கு தனிப்பட்ட இசை — குறைந்த விலையில் அமைத்து தருகிறோம்.
            </p>
            <Link
              href="/music-composition"
              className="inline-flex items-center gap-2 px-8 py-4 bg-white text-purple-700 rounded-full font-bold hover:bg-purple-50 transition-all shadow-2xl transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60 font-tamil text-lg"
            >
              <span aria-hidden="true">🎵</span>
              <span>மேலும் அறிய</span>
            </Link>
          </div>
        </div>
      </section>

      </main>

      <Footer />
    </div>
  );
}


