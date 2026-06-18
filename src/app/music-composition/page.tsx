/**
 * Music Composition Service Page
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { JsonLd } from '@/components/JsonLd';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { TrackedYouTubeAnchor } from '@/components/TrackedYouTubeAnchor';
import { SITE_URL, SITE_NAME, alternatesFor, breadcrumbJsonLd } from '@/lib/seo';
import { isYouTubeChannelConfigured, youtubeSubscribeUrl } from '@/config/site';
import { MUSIC, hasMusicSamples, hasWhatsApp, whatsappLink } from '@/config/music';

const META_TITLE = 'இசையமைப்பு சேவை · Tamil Music Composition';
const META_DESCRIPTION =
  'உங்கள் தமிழ் பாடல் வரிகளுக்கு தனிப்பட்ட இசை — மலிவான விலையில். தமிழகவல் இசையமைப்பு சேவை: இலவச மதிப்பீடு. ' +
  'Custom Tamil music composition for your lyrics — affordable, free quote.';

export const metadata: Metadata = {
  title: META_TITLE,
  description: META_DESCRIPTION,
  alternates: alternatesFor('/music-composition'),
  openGraph: {
    title: `${META_TITLE} | ${SITE_NAME}`,
    description: META_DESCRIPTION,
    url: '/music-composition',
    siteName: SITE_NAME,
    locale: 'ta_IN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${META_TITLE} | ${SITE_NAME}`,
    description: META_DESCRIPTION,
  },
};

const ORDER_HREF = '/contact?subject=Music%20Composition%20Request';

// FAQ content — drives both the visible list and the FAQPage structured data.
const FAQ: { q: string; a: string }[] = [
  {
    q: 'விலை எவ்வளவு?',
    a: 'ஒவ்வொரு பாடலுக்கும் தேவைக்கேற்ப மலிவான, தனிப்பயன் விலை. உங்கள் கோரிக்கையை அனுப்பினால் இலவச மதிப்பீடு (quote) வழங்குகிறோம்.',
  },
  {
    q: 'எவ்வளவு நேரம் ஆகும்?',
    a: 'உங்கள் பாடலின் தேவையைப் பொறுத்து மாறும்; கோரிக்கையை உறுதிசெய்யும்போது காலக்கெடுவைத் தெரிவிக்கிறோம்.',
  },
  {
    q: 'எந்த மொழிகளில் இசை அமைக்கிறீர்கள்?',
    a: 'முதன்மையாக தமிழ்; பிற மொழிகளுக்கும் கோரிக்கையின் பேரில் அமைத்து தருகிறோம்.',
  },
  {
    q: 'திருத்தங்கள் செய்ய முடியுமா?',
    a: 'ஆம் — திருத்தங்கள் உங்கள் திட்டத்தின் ஒப்பந்தத்தில் சேர்க்கப்படும்.',
  },
  {
    q: 'முடிக்கப்பட்ட இசையின் உரிமைகள் யாருக்கு?',
    a: 'பயன்பாட்டு உரிமைகள் ஒவ்வொரு திட்டத்திலும் தனித்தனியாக ஒப்புக்கொள்ளப்படும்.',
  },
  {
    q: 'எப்படி ஆர்டர் செய்வது?',
    a: 'தொடர்பு படிவத்தின் மூலம் உங்கள் பாடல் வரிகளையும் தேவைகளையும் அனுப்புங்கள். விரைவில் பதிலளிக்கிறோம்.',
  },
];

const CHECKLIST = [
  'உங்கள் பாடல் வரிகள்',
  'மொழி (தமிழ் / பிற)',
  'இசை வகை மற்றும் உணர்வு (மகிழ்ச்சி, சோகம், பக்தி…)',
  'தோராயமான நீளம் / காலம்',
  'சந்தர்ப்பம் (திருமணம், பிறந்தநாள், விளம்பரம்…)',
  'குறிப்பு பாடல் இணைப்பு (விருப்பம்)',
];

const jsonLd = [
  breadcrumbJsonLd([
    { name: 'Tamilagaval', path: '/' },
    { name: 'Music Composition', path: '/music-composition' },
  ]),
  {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Music Composition Service',
    serviceType: 'Music composition',
    inLanguage: 'ta',
    url: `${SITE_URL}/music-composition`,
    provider: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    areaServed: 'Worldwide',
    description: 'Affordable custom Tamil music composition by the தமிழகவல் team. Free quote on request.',
    // No fixed price (custom quote per song), so we omit a priceless Offer
    // (which Rich Results flags) and point to the request flow instead.
    potentialAction: {
      '@type': 'OrderAction',
      target: `${SITE_URL}${ORDER_HREF}`,
    },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  },
];

export default function MusicCompositionPage() {
  const showSamples = hasMusicSamples();
  const showChannelFallback = !showSamples && isYouTubeChannelConfigured();

  return (
    <div className="min-h-screen bg-gray-900">
      <Header />
      <JsonLd data={jsonLd} />

      {/* Hero */}
      <section className="text-white pt-28 pb-20">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <div className="text-6xl mb-4" aria-hidden="true">🎼</div>
          <h1 className="text-4xl sm:text-5xl font-extrabold font-poem mb-4 leading-tight">
            இசையமைப்பு சேவை
          </h1>
          <p className="text-lg sm:text-xl text-white/95 font-tamil leading-relaxed mb-8">
            உங்கள் பாடல் வரிகளுக்கு தனிப்பட்ட இசை — மலிவான விலையில் அமைத்து தருகிறோம்.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href={ORDER_HREF}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-orange-600 rounded-full font-bold hover:bg-orange-50 transition-all shadow-2xl transform hover:scale-105 font-tamil text-lg"
            >
              <span aria-hidden="true">🎵</span>
              <span>இலவச மதிப்பீட்டைப் பெறுங்கள்</span>
            </Link>
            {hasWhatsApp() && (
              <a
                href={whatsappLink()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-green-500 text-white rounded-full font-bold hover:bg-green-600 transition-all shadow-lg font-tamil text-lg"
              >
                <span aria-hidden="true">💬</span>
                <span>WhatsApp</span>
              </a>
            )}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-white mb-4 font-tamil">
            எப்படி வேலை செய்கிறது
          </h2>
          <p className="text-center text-gray-300 font-tamil mb-12 max-w-2xl mx-auto">
            மூன்று எளிய படிகளில் உங்கள் பாடலுக்கு இசை
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <StepCard num="1" icon="✍️" title="கோரிக்கை அனுப்புங்கள்" desc="தொடர்பு படிவத்தின் மூலம் உங்கள் பாடல் வரிகள் மற்றும் தேவைகளை அனுப்புங்கள்." />
            <StepCard num="2" icon="🎹" title="நாங்கள் இசை அமைக்கிறோம்" desc="எங்கள் AI இசை தளத்தில், உங்கள் பாடல் வரிகளுக்கு ஏற்ப கவனமாக இசை வடிவமைத்து மெருகேற்றுகிறோம்." />
            <StepCard num="3" icon="🎧" title="உங்கள் இசையைப் பெறுங்கள்" desc="முடிக்கப்பட்ட இசையை நீங்கள் பெற்று மகிழுங்கள்." />
          </div>
        </div>
      </section>

      {/* Pricing / quote */}
      <section className="bg-gray-800 py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto bg-gray-900 border border-gray-700 rounded-2xl p-10 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 font-tamil">விலை</h2>
            <p className="text-lg text-gray-300 font-tamil leading-relaxed mb-2">
              ஒவ்வொரு பாடலும் தனித்துவமானது — அதனால் விலையும் உங்கள் தேவைக்கேற்ப தனிப்பயனாக்கப்படுகிறது.
            </p>
            <p className="text-2xl font-bold text-orange-400 font-tamil mb-8">மலிவான விலை · இலவச மதிப்பீடு</p>
            <Link
              href={ORDER_HREF}
              className="inline-flex items-center gap-2 px-8 py-4 bg-orange-600 text-white rounded-full font-bold hover:bg-orange-700 transition-colors shadow-lg font-tamil text-lg"
            >
              <span aria-hidden="true">💬</span>
              <span>இலவச மதிப்பீட்டைக் கேளுங்கள்</span>
            </Link>
          </div>
        </div>
      </section>

      {/* What to include */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-white mb-4 font-tamil">
            கோரிக்கையில் என்ன சேர்க்க வேண்டும்
          </h2>
          <p className="text-center text-gray-300 font-tamil mb-10">
            கீழே உள்ளவற்றை அனுப்பினால் விரைவாகவும் துல்லியமாகவும் இசை அமைக்க முடியும்.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {CHECKLIST.map((item) => (
              <li key={item} className="flex items-start gap-3 bg-gray-800 rounded-xl p-4 border border-gray-700">
                <span className="text-green-400 text-xl flex-shrink-0" aria-hidden="true">✓</span>
                <span className="text-gray-200 font-tamil leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Samples */}
      <section className="bg-gray-800 py-20">
        <div className="container mx-auto px-4 max-w-5xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-white mb-10 font-tamil">
            எங்கள் இசை மாதிரிகள்
          </h2>
          {showSamples ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {MUSIC.sampleVideoUrls.map((url) => (
                <YouTubeEmbed key={url} url={url} title="இசை மாதிரி" />
              ))}
            </div>
          ) : (
            <div className="text-center">
              <p className="text-gray-300 font-tamil mb-6">
                எங்கள் இசை மாதிரிகளை YouTube சேனலில் கேளுங்கள்.
              </p>
              {showChannelFallback && (
                <TrackedYouTubeAnchor
                  href={youtubeSubscribeUrl('music_composition_samples')}
                  source="music_composition_samples"
                  ariaLabel="YouTube"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-orange-600 text-white rounded-full font-bold hover:bg-orange-700 transition-colors shadow-lg text-sm"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                  <span>YouTube</span>
                </TrackedYouTubeAnchor>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Why us */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-white mb-12 font-tamil">
            ஏன் எங்கள் இசையமைப்பு?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FeatureCard icon="💰" title="மலிவான விலை" desc="மலிவான கட்டணத்தில் தரமான இசையமைப்பு." />
            <FeatureCard icon="🎯" title="தனிப்பட்ட இசை" desc="உங்கள் பாடலுக்கு மட்டுமே அமைக்கப்படும் அசல் இசை." />
            <FeatureCard icon="🎹" title="AI இசை தளம்" desc="எங்கள் AI இசை தளத்தில் உருவாக்கி, ஒவ்வொரு பாடலையும் கவனமாக மெருகேற்றி வழங்குகிறோம்." />
            <FeatureCard icon="⚡" title="விரைவான சேவை" desc="உங்கள் கோரிக்கைக்கு விரைவாக பதிலளிக்கிறோம்." />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gray-800 py-20">
        <div className="container mx-auto px-4 max-w-3xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-white mb-12 font-tamil">
            அடிக்கடி கேட்கப்படும் கேள்விகள்
          </h2>
          <div className="space-y-4">
            {FAQ.map((f) => (
              <details key={f.q} className="bg-gray-900 rounded-xl border border-gray-700 p-5 group">
                <summary className="cursor-pointer font-semibold text-white font-tamil list-none flex items-center justify-between">
                  <span>{f.q}</span>
                  <span className="text-orange-400 group-open:rotate-45 transition-transform" aria-hidden="true">＋</span>
                </summary>
                <p className="text-gray-300 font-tamil leading-relaxed mt-3">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="max-w-2xl mx-auto bg-orange-600 rounded-2xl p-10">
          <h2 className="text-3xl font-bold text-white mb-4 font-tamil">
            உங்கள் பாடலுக்கு இசை வேண்டுமா?
          </h2>
          <p className="text-orange-50 font-tamil mb-8">
            இன்றே உங்கள் இசையமைப்பு கோரிக்கையை அனுப்புங்கள் — இலவச மதிப்பீடு.
          </p>
          <Link
            href={ORDER_HREF}
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-orange-600 rounded-full font-bold hover:bg-orange-50 transition-all shadow-lg transform hover:scale-105 font-tamil text-lg"
          >
            <span aria-hidden="true">🎵</span>
            <span>இசையமைப்பு கோரிக்கை</span>
          </Link>
        </div>
      </section>
      <Footer />
    </div>
  );
}

function StepCard({ num, icon, title, desc }: { num: string; icon: string; title: string; desc: string }) {
  return (
    <div className="relative bg-gray-800 rounded-2xl p-8 text-center border border-gray-700">
      <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center font-bold text-white">
        {num}
      </div>
      <div className="text-5xl mb-4 mt-2" aria-hidden="true">{icon}</div>
      <h3 className="text-xl font-bold text-white mb-3 font-tamil">{title}</h3>
      <p className="text-gray-300 font-tamil leading-relaxed">{desc}</p>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-4 bg-gray-900 rounded-xl p-6 border border-gray-700">
      <div className="text-4xl flex-shrink-0" aria-hidden="true">{icon}</div>
      <div>
        <h3 className="text-lg font-bold text-white mb-1 font-tamil">{title}</h3>
        <p className="text-gray-300 font-tamil leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
