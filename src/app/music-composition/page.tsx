/**
 * Music Composition Service Page
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import { JsonLd } from '@/components/JsonLd';
import { SITE_URL, SITE_NAME } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'இசையமைப்பு சேவை',
  description: 'உங்கள் தமிழ் பாடல் வரிகளுக்கு தனிப்பட்ட இசை — குறைந்த விலையில். தமிழகவல் இசையமைப்பு சேவை.',
  alternates: { canonical: '/music-composition' },
};

const ORDER_HREF = '/contact?subject=Music%20Composition%20Request';

const serviceJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'Music Composition Service',
  serviceType: 'Music composition',
  inLanguage: 'ta',
  url: `${SITE_URL}/music-composition`,
  provider: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  areaServed: 'Worldwide',
  description: 'Custom Tamil music composition at low cost, by the தமிழகவல் team.',
};

export default function MusicCompositionPage() {
  return (
    <div className="min-h-screen bg-gray-900">
      <Header />
      <JsonLd data={serviceJsonLd} />

      {/* Hero */}
      <section className="bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white pt-28 pb-20">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <div className="text-6xl mb-4">🎼</div>
          <h1 className="text-4xl sm:text-5xl font-extrabold font-poem mb-4 leading-tight">
            இசையமைப்பு சேவை
          </h1>
          <p className="text-lg sm:text-xl text-white/95 font-tamil leading-relaxed mb-8">
            உங்கள் பாடல் வரிகளுக்கு தனிப்பட்ட இசை — குறைந்த விலையில் அமைத்து தருகிறோம்.
          </p>
          <Link
            href={ORDER_HREF}
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-orange-600 rounded-full font-bold hover:bg-orange-50 transition-all shadow-2xl transform hover:scale-105 font-tamil text-lg"
          >
            <span>🎵</span>
            <span>இசையமைப்பு கோரிக்கை அனுப்புங்கள்</span>
          </Link>
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
            <StepCard
              num="1"
              icon="✍️"
              title="கோரிக்கை அனுப்புங்கள்"
              desc="தொடர்பு படிவத்தின் மூலம் உங்கள் பாடல் வரிகள் மற்றும் தேவைகளை அனுப்புங்கள்."
            />
            <StepCard
              num="2"
              icon="🎹"
              title="நாங்கள் இசை அமைக்கிறோம்"
              desc="எங்கள் சொந்த இசை தளம் மற்றும் கலைஞர்களைக் கொண்டு உங்கள் பாடலுக்கு இசை அமைக்கிறோம்."
            />
            <StepCard
              num="3"
              icon="🎧"
              title="உங்கள் இசையைப் பெறுங்கள்"
              desc="முடிக்கப்பட்ட இசையை நீங்கள் பெற்று மகிழுங்கள்."
            />
          </div>
        </div>
      </section>

      {/* Why us */}
      <section className="bg-gray-800 py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-center text-white mb-12 font-tamil">
              ஏன் எங்கள் இசையமைப்பு?
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FeatureCard icon="💰" title="குறைந்த விலை" desc="மலிவான கட்டணத்தில் தரமான இசையமைப்பு." />
              <FeatureCard icon="🎯" title="தனிப்பட்ட இசை" desc="உங்கள் பாடலுக்கு மட்டுமே அமைக்கப்படும் அசல் இசை." />
              <FeatureCard icon="🤖" title="சொந்த இசை தளம்" desc="SUNO போன்ற எங்கள் சொந்த AI இசை தளத்தைக் கொண்டது." />
              <FeatureCard icon="⚡" title="விரைவான சேவை" desc="உங்கள் கோரிக்கைக்கு விரைவாக பதிலளிக்கிறோம்." />
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="max-w-2xl mx-auto bg-gradient-to-r from-purple-600 to-purple-800 rounded-2xl p-10">
          <h2 className="text-3xl font-bold text-white mb-4 font-tamil">
            உங்கள் பாடலுக்கு இசை வேண்டுமா?
          </h2>
          <p className="text-purple-100 font-tamil mb-8">
            இன்றே உங்கள் இசையமைப்பு கோரிக்கையை அனுப்புங்கள்.
          </p>
          <Link
            href={ORDER_HREF}
            className="inline-flex items-center gap-2 px-8 py-4 bg-white text-purple-700 rounded-full font-bold hover:bg-purple-50 transition-all shadow-lg transform hover:scale-105 font-tamil text-lg"
          >
            <span>🎵</span>
            <span>இசையமைப்பு கோரிக்கை</span>
          </Link>
        </div>
      </section>
    </div>
  );
}

function StepCard({ num, icon, title, desc }: { num: string; icon: string; title: string; desc: string }) {
  return (
    <div className="relative bg-gray-800 rounded-2xl p-8 text-center border border-gray-700">
      <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center font-bold text-white">
        {num}
      </div>
      <div className="text-5xl mb-4 mt-2">{icon}</div>
      <h3 className="text-xl font-bold text-white mb-3 font-tamil">{title}</h3>
      <p className="text-gray-300 font-tamil leading-relaxed">{desc}</p>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-4 bg-gray-900 rounded-xl p-6 border border-gray-700">
      <div className="text-4xl flex-shrink-0">{icon}</div>
      <div>
        <h3 className="text-lg font-bold text-white mb-1 font-tamil">{title}</h3>
        <p className="text-gray-300 font-tamil leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
