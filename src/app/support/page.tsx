/**
 * /support — how fans can support Tamilagaval. In the YouTube Partner Program
 * era the site's job is to convert its owned audience into channel subscribers
 * (the binding gate) and fan-funders. Warm, gratitude-first — never a hard sell.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SupportCTA } from '@/components/SupportCTA';
import { alternatesFor } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'ஆதரவு · Support Tamilagaval',
  description:
    'தமிழகவலை ஆதரிக்கும் வழிகள் — Subscribe, Super Thanks, மற்றும் பாடல்களைப் பகிர்தல். Ways to support original Tamil songs, poems and stories on Tamilagaval.',
  alternates: alternatesFor('/support'),
};

export default function SupportPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-950">
      <Header />
      <main id="main" className="flex-1 pt-20">
        <section className="container mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
          <h1 className="font-tamil text-3xl font-bold text-white sm:text-4xl">
            💛 தமிழகவலை ஆதரியுங்கள்
          </h1>
          <p className="mt-3 font-tamil leading-relaxed text-gray-300">
            35 ஆண்டுகளுக்கும் மேலாக எழுதிவரும் அசல் தமிழ்ப் பாடல்கள், கவிதைகள், கதைகள் —
            இவை உங்கள் அன்பான ஆதரவினால் மட்டுமே தொடர்கின்றன. உங்கள் சிறிய ஆதரவு கூட பெரிய ஊக்கம். 🙏
          </p>

          <div className="mt-8">
            <SupportCTA source="support-page" />
          </div>

          <div className="mt-10 space-y-6 font-tamil text-gray-300">
            <div>
              <h2 className="mb-1 text-lg font-bold text-white">🔔 Subscribe செய்யுங்கள் (இலவசம்)</h2>
              <p className="text-sm text-gray-400">
                YouTube சேனலை Subscribe செய்வது இலவசம் — ஆனால் இதுவே மிகப் பெரிய ஆதரவு. புதிய
                பாடல்கள் உங்களை உடனே வந்தடையும்.
              </p>
            </div>
            <div>
              <h2 className="mb-1 text-lg font-bold text-white">💝 Super Thanks அளியுங்கள்</h2>
              <p className="text-sm text-gray-400">
                எந்தப் பாடலின் கீழும் உள்ள &ldquo;Thanks&rdquo; பொத்தானை அழுத்தி, விரும்பினால்
                உங்கள் ஆதரவை நேரடியாகக் காட்டலாம்.
              </p>
            </div>
            <div>
              <h2 className="mb-1 text-lg font-bold text-white">❤️ பகிர்ந்து ஆதரியுங்கள்</h2>
              <p className="text-sm text-gray-400">
                பிடித்த பாடலை நண்பர்களுடனும் குடும்பத்தினருடனும் பகிர்வது — தமிழ் இசையைத்
                தொடர்ந்து பரப்ப உதவும். இதற்குச் செலவே இல்லை.
              </p>
            </div>
          </div>

          <p className="mt-10 font-tamil text-sm text-gray-500">
            உங்கள் ஒவ்வொருவரின் அன்பிற்கும் மனமார்ந்த நன்றி. —{' '}
            <Link href="/songs" className="text-orange-400 hover:underline">
              பாடல்களைக் கேளுங்கள்
            </Link>
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
