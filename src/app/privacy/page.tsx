/**
 * /privacy — a plain-spoken privacy notice. Disclosed because the site now
 * loads Google Analytics 4 with anonymised IPs; that's the only third-party
 * tracking. No advertising, no consent banner needed (anonymised aggregate
 * analytics on a personal art site).
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';

// Crawler-facing metadata in English (this page is purely a disclosure;
// the visible UI on /privacy is in Tamil for actual readers).
const META_TITLE = 'Privacy';
const META_DESCRIPTION =
  'Privacy notice for Tamilagaval — what data is collected (anonymised analytics) and how to opt out.';

export const metadata: Metadata = {
  title: META_TITLE,
  description: META_DESCRIPTION,
  alternates: { canonical: '/privacy' },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Header />

      <section className="relative w-full overflow-hidden bg-gradient-to-br from-orange-500 via-orange-600 to-orange-700 text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_12%_-15%,rgba(255,255,255,0.35),transparent_55%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-gray-900" />
        <div className="relative container mx-auto px-6 py-16 sm:px-10">
          <h1 className="font-kavivanar text-4xl font-extrabold leading-tight drop-shadow-md sm:text-5xl">
            தனியுரிமை
          </h1>
          <p className="mt-3 max-w-2xl font-tamil text-white/90">
            தமிழகவல் தளம் என்ன தகவல்களைச் சேகரிக்கிறது மற்றும் ஏன் என்பதைப் பற்றிய எளிய விளக்கம்.
          </p>
        </div>
      </section>

      <main className="container mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="space-y-8 font-tamil leading-relaxed text-gray-300">
          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">சுருக்கம்</h2>
            <p>
              தமிழகவல் ஒரு தனிப்பட்ட இலவச தளம். உங்கள் பெயரோ, மின்னஞ்சலோ, கடவுச்சொல்லோ கேட்கப்படுவதில்லை — நீங்களாகவே தொடர்பு கொள்ள விரும்பினால் தவிர. விளம்பரங்கள் இல்லை. யாருக்கும் தகவல் விற்கப்படுவதில்லை.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">பயன்பாட்டுப் புள்ளிவிவரங்கள் (Google Analytics)</h2>
            <p className="mb-3">
              எத்தனை பேர் வருகிறார்கள், எந்தப் பக்கங்கள் பிரபலமாக உள்ளன என்பதைப் புரிந்துகொள்ள Google Analytics 4 பயன்படுத்தப்படுகிறது. உங்கள் IP முகவரி <strong className="text-white">அநாமதேயப்படுத்தப்படுகிறது</strong> (anonymize_ip) — அதாவது உங்களைத் தனிப்பட்ட நபராக அடையாளம் காண முடியாது.
            </p>
            <p>
              உங்கள் உலாவியின் &ldquo;Do Not Track&rdquo; அமைப்பு அல்லது{' '}
              <a
                href="https://tools.google.com/dlpage/gaoptout"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400 underline-offset-2 hover:underline"
              >
                Google Analytics Opt-out Browser Add-on
              </a>
              {' '}மூலம் இதை முழுமையாக நிறுத்தலாம்.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">YouTube & மூன்றாம் தரப்பு உள்ளடக்கம்</h2>
            <p>
              காணொளிகள் YouTube-ல் இருந்து இயக்கப்படுகின்றன. அவற்றை இயக்கும்போது YouTube-ன் சொந்த தனியுரிமைக் கொள்கை பொருந்தும். YouTube பற்றிய தகவலுக்கு:{' '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400 underline-offset-2 hover:underline"
              >
                Google Privacy Policy
              </a>.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">தொடர்புப் படிவம்</h2>
            <p>
              <Link href="/contact" className="text-orange-400 underline-offset-2 hover:underline">தொடர்புப் பக்கம்</Link> மூலம் நீங்களாகவே ஒரு செய்தி அனுப்பினால் மட்டுமே, அந்தச் செய்தியும் (உங்கள் மின்னஞ்சல் இருந்தால் அதுவும்) எனக்கு வரும். பதிலளிக்க மட்டுமே பயன்படுத்தப்படும்.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">கேள்விகள்?</h2>
            <p>
              தனியுரிமை பற்றிய எந்தக் கேள்விக்கும்{' '}
              <Link href="/contact" className="text-orange-400 underline-offset-2 hover:underline">தொடர்பு கொள்ளுங்கள்</Link>.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
