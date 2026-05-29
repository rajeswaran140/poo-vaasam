/**
 * முகப்பு பக்கம் - பொது
 * தமிழ் உள்ளடக்கத்துடன் அம்சமான தரவு பக்கம்
 */

export const revalidate = 300;

import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import { SITE, liveContentSections, isYouTubeChannelConfigured, isFacebookConfigured, isYouTubeVideosConfigured, youtubeSubscribeUrl } from '@/config/site';
import { fetchChannelVideos } from '@/lib/youtube-feed';
import { SubscribeButton } from '@/components/SubscribeButton';
import { JsonLd } from '@/components/JsonLd';
import { SITE_URL, SITE_NAME } from '@/lib/seo';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  description: 'ரஜேஸ்வரன் தங்கராஜாவின் தமிழ் கவிதைகளும் பாடல்களும் — இலவசமாகப் படியுங்கள், கேளுங்கள். YouTube-ல் காணொளிகளும்.',
};

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: 'ta',
  description: 'ரஜேஸ்வரன் தங்கராஜாவின் தமிழ் கவிதைகளும் பாடல்களும் — என்றும் இலவசம்.',
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/ai-search?q={search_term_string}` },
    'query-input': 'required name=search_term_string',
  },
};

// The site is one creator's body of work, so advertise the author (Person)
// with links to their channels — helps Google connect the site to the creator.
const personSameAs: string[] = [
  ...(isYouTubeChannelConfigured() ? [SITE.youtube.channelUrl] : []),
  ...(isFacebookConfigured() ? [SITE.facebook.url] : []),
];

const personJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Rajeswaran Thangarajah',
  alternateName: 'ரஜேஸ்வரன் தங்கராஜா',
  url: SITE_URL,
  jobTitle: 'Tamil poet and lyricist',
  ...(personSameAs.length > 0 ? { sameAs: personSameAs } : {}),
};

export default async function HomePage() {
  const latestVideos = isYouTubeVideosConfigured()
    ? await fetchChannelVideos(SITE.youtube.channelId, 4)
    : [];

  return (
    <div className="min-h-screen bg-gray-900">
      <JsonLd data={websiteJsonLd} />
      <JsonLd data={personJsonLd} />
      <Header />

      {/* Hero Section - Centered */}
      <section className="relative overflow-hidden bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white pt-20">
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
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
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
                </div>

                {/* Feature Pills - Consistent Sizing */}
                <div className="flex flex-wrap gap-4 justify-center items-center">
                  <div className="flex items-center gap-3 bg-white/15 backdrop-blur-sm rounded-xl px-6 py-3.5 border border-white/20 shadow-lg">
                    <span className="text-2xl">📖</span>
                    <span className="font-semibold font-tamil text-base">வாசிப்பு</span>
                  </div>
                  <div className="flex items-center gap-3 bg-white/15 backdrop-blur-sm rounded-xl px-6 py-3.5 border border-white/20 shadow-lg">
                    <span className="text-2xl">🎧</span>
                    <span className="font-semibold font-tamil text-base">கேட்டல்</span>
                  </div>
                  <div className="flex items-center gap-3 bg-white/15 backdrop-blur-sm rounded-xl px-6 py-3.5 border border-white/20 shadow-lg">
                    <span className="text-2xl">🚫</span>
                    <span className="font-semibold font-tamil text-base">விளம்பரங்கள் இல்லை</span>
                  </div>
                </div>

                {/* CTA Buttons - Centered */}
                <div className="flex flex-col sm:flex-row gap-4 pt-6 justify-center">
                  <Link
                    href="/songs"
                    className="group px-10 py-5 bg-white text-orange-600 rounded-full font-bold hover:bg-orange-50 transition-all shadow-2xl hover:shadow-3xl transform hover:scale-105 font-tamil inline-flex items-center justify-center gap-3 text-lg"
                  >
                    <span className="text-2xl">🎵</span>
                    <span>இப்போதே தொடங்குங்கள்</span>
                    <svg className="w-6 h-6 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </Link>
                  {isYouTubeChannelConfigured() && (
                    <SubscribeButton
                      label="YouTube-ல் Subscribe செய்க"
                      className="px-10 py-5 bg-orange-700 text-white rounded-full font-bold hover:bg-orange-800 transition-all shadow-2xl transform hover:scale-105 font-tamil inline-flex items-center justify-center gap-3 text-lg"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Latest YouTube videos — funnel to the channel */}
      {latestVideos.length > 0 && (
        <section className="bg-gray-900 pt-16 pb-4">
          <div className="container mx-auto px-4 max-w-6xl">
            <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
              <h2 className="text-3xl font-bold text-white font-kavivanar">சமீபத்திய காணொளிகள்</h2>
              <div className="flex items-center gap-4">
                <SubscribeButton label="YouTube" />
                <Link href="/videos" className="text-orange-400 hover:text-orange-300 font-tamil font-medium">
                  அனைத்தும் →
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {latestVideos.map((video) => (
                <a
                  key={video.id}
                  href={video.watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-xl overflow-hidden bg-gray-800 border border-gray-700 hover:border-orange-500/50 transition"
                >
                  <div className="relative aspect-video bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={video.thumbnail}
                      alt={video.title}
                      loading="lazy"
                      className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition"
                    />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/90 shadow-lg">
                        <svg className="w-6 h-6 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </span>
                    </span>
                  </div>
                  <div className="p-3">
                    <h3 className="line-clamp-2 text-sm text-gray-200 font-tamil">{video.title}</h3>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

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

          <div className="grid md:grid-cols-3 gap-8 mb-12">
            {/* Feature 1: Free Reading */}
            <div className="text-center p-8 bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl hover:shadow-xl transition-shadow">
              <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <span className="text-4xl">📖</span>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4 font-tamil leading-snug">
                வரம்பற்ற வாசிப்பு
              </h3>
              <p className="text-base text-gray-600 font-tamil leading-loose">
                எல்லா உள்ளடக்கங்களையும் இலவசமாக படியுங்கள். எந்த வரம்பும் இல்லை, எந்த கட்டணமும் இல்லை.
              </p>
            </div>

            {/* Feature 2: Free Audio */}
            <div className="text-center p-8 bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl hover:shadow-xl transition-shadow">
              <div className="w-20 h-20 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <span className="text-4xl">🎧</span>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4 font-tamil leading-snug">
                இலவச ஆடியோ
              </h3>
              <p className="text-base text-gray-600 font-tamil leading-loose">
                உங்கள் பிடித்த கவிதைகளையும் பாடல்களையும் கேளுங்கள். எங்கு வேண்டுமானாலும், எப்போது வேண்டுமானாலும்.
              </p>
            </div>

            {/* Feature 3: No Ads */}
            <div className="text-center p-8 bg-gradient-to-br from-green-50 to-green-100 rounded-2xl hover:shadow-xl transition-shadow">
              <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <span className="text-4xl">✨</span>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4 font-tamil leading-snug">
                விளம்பரங்கள் இல்லை
              </h3>
              <p className="text-base text-gray-600 font-tamil leading-loose">
                தடையற்ற அனுபவம். விளம்பரங்கள் இல்லாமல், உங்கள் வாசிப்பில் கவனம் செலுத்துங்கள்.
              </p>
            </div>
          </div>

          {/* Additional Benefits */}
          <div className="bg-gradient-to-r from-purple-100 to-pink-100 rounded-2xl p-8 md:p-12">
            <div className="grid md:grid-cols-2 gap-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 mb-2 font-tamil text-base leading-normal">எந்த பதிவும் தேவையில்லை</h4>
                  <p className="text-gray-700 font-tamil leading-relaxed">உடனடியாக படிக்க ஆரம்பியுங்கள்</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 mb-2 font-tamil text-base leading-normal">மொபைல் நட்பு</h4>
                  <p className="text-gray-700 font-tamil leading-relaxed">எந்த சாதனத்திலும் படிக்கவும் கேட்கவும்</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 mb-2 font-tamil text-base leading-normal">சொந்தப் படைப்புகள்</h4>
                  <p className="text-gray-700 font-tamil leading-relaxed">ரஜேஸ்வரனின் சொந்தக் கவிதைகளும் பாடல்களும்</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 mb-2 font-tamil text-base leading-normal">தொடர்ச்சியான புதுப்பிப்புகள்</h4>
                  <p className="text-gray-700 font-tamil leading-relaxed">வாரம் தோறும் புதிய உள்ளடக்கம்</p>
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
            <div className="text-5xl mb-4">🎼</div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 font-tamil">இசையமைப்பு சேவை</h2>
            <p className="text-lg text-purple-100 font-tamil mb-8 max-w-2xl mx-auto leading-relaxed">
              உங்கள் பாடல் வரிகளுக்கு தனிப்பட்ட இசை — குறைந்த விலையில் அமைத்து தருகிறோம்.
            </p>
            <Link
              href="/music-composition"
              className="inline-flex items-center gap-2 px-8 py-4 bg-white text-purple-700 rounded-full font-bold hover:bg-purple-50 transition-all shadow-2xl transform hover:scale-105 font-tamil text-lg"
            >
              <span>🎵</span>
              <span>மேலும் அறிய</span>
            </Link>
          </div>
        </div>
      </section>

      {/* அடிக்குறிப்பு */}
      <footer className="relative bg-gray-900 text-white py-12">
        {/* brand accent — ties the footer to the orange hero */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-500/70 to-transparent" />

        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-2xl font-bold mb-3 font-kavivanar">தமிழகவல்</h3>
              <p className="text-gray-400 font-tamil text-sm mb-5">
                தமிழ் கவிதைகள் · பாடல்கள் · காணொளிகள்
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {isYouTubeChannelConfigured() && (
                  <a
                    href={youtubeSubscribeUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white rounded-full font-bold hover:opacity-90 transition-opacity font-tamil text-sm shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                    </svg>
                    <span>சந்தா செலுத்துங்கள்</span>
                  </a>
                )}
                {isFacebookConfigured() && (
                  <a
                    href={SITE.facebook.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Facebook"
                    className="inline-flex items-center justify-center w-11 h-11 bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white rounded-full hover:opacity-90 transition-opacity shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-4 font-tamil">விரைவு இணைப்புகள்</h4>
              <ul className="space-y-2 text-gray-400">
                {liveContentSections().map((s) => (
                  <li key={s.href}><Link href={s.href} className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">{s.label}</Link></li>
                ))}
                {isYouTubeVideosConfigured() && (
                  <li><Link href="/videos" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">காணொளிகள்</Link></li>
                )}
                <li><Link href="/music-composition" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">இசையமைப்பு சேவை</Link></li>
                <li><Link href="/all" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">அனைத்து உள்ளடக்கம்</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 font-tamil">பற்றி</h4>
              <ul className="space-y-2 text-gray-400">
                <li><Link href="/about" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">எங்களை பற்றி</Link></li>
                <li><Link href="/contact" className="hover:text-white font-tamil focus-visible:outline-none focus-visible:underline">தொடர்பு</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
            <p className="font-tamil">© {new Date().getFullYear()} ரஜேஸ்வரன் தங்கராஜா · தமிழகவல்</p>
          </div>
        </div>
      </footer>
    </div>
  );
}


