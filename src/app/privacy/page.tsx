/**
 * /privacy — a plain-spoken privacy notice. Disclosed because the site loads
 * Google Analytics 4 with anonymised IPs; that's the only third-party tracking.
 * Bilingual (Tamil + English) so visitors in either language can read it.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';

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

      <section className="relative w-full overflow-hidden text-white">
        <div className="relative container mx-auto px-6 py-16 sm:px-10">
          <h1 className="font-kavivanar text-4xl font-extrabold leading-tight drop-shadow-md sm:text-5xl">
            தனியுரிமை · Privacy
          </h1>
          <p className="mt-3 max-w-2xl font-tamil text-white/90">
            தமிழகவல் தளம் என்ன தகவல்களைச் சேகரிக்கிறது மற்றும் ஏன் என்பதைப் பற்றிய எளிய விளக்கம்.
          </p>
          <p className="mt-2 max-w-2xl text-white/80">
            A plain-English explanation of what Tamilagaval collects and why.
          </p>
        </div>
      </section>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="space-y-10 leading-relaxed text-gray-300">

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              சுருக்கம் · Summary
            </h2>
            <p className="mb-3 font-tamil">
              தமிழகவல் ஒரு தனிப்பட்ட இலவச தளம். உங்கள் பெயரோ, மின்னஞ்சலோ, கடவுச்சொல்லோ கேட்கப்படுவதில்லை — நீங்களாகவே தொடர்பு கொள்ள விரும்பினால் தவிர. விளம்பரங்கள் இல்லை. யாருக்கும் தகவல் விற்கப்படுவதில்லை.
            </p>
            <p>
              Tamilagaval is a personal, free website. We don&apos;t ask for your name, email or password unless you choose to contact us yourself. No ads, no selling your data to anyone.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              பயன்பாட்டுப் புள்ளிவிவரங்கள் · Analytics
            </h2>
            <p className="mb-3 font-tamil">
              எத்தனை பேர் வருகிறார்கள், எந்தப் பக்கங்கள் பிரபலமாக உள்ளன என்பதைப் புரிந்துகொள்ள Google Analytics 4 பயன்படுத்தப்படுகிறது. உங்கள் IP முகவரி <strong className="text-white">அநாமதேயப்படுத்தப்படுகிறது</strong> (anonymize_ip) — அதாவது உங்களைத் தனிப்பட்ட நபராக அடையாளம் காண முடியாது.
            </p>
            <p className="mb-3">
              We use Google Analytics 4 to understand how many people visit and which pages are popular. Your IP address is <strong className="text-white">anonymised</strong> before storage — you cannot be identified as an individual.
            </p>
            <p className="font-tamil">
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
            <p>
              You can fully opt out via your browser&apos;s &ldquo;Do Not Track&rdquo; setting or by installing the{' '}
              <a
                href="https://tools.google.com/dlpage/gaoptout"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-400 underline-offset-2 hover:underline"
              >
                Google Analytics Opt-out Browser Add-on
              </a>.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              YouTube &amp; மூன்றாம் தரப்பு · YouTube &amp; third parties
            </h2>
            <p className="mb-3 font-tamil">
              காணொளிகள் YouTube-ல் இருந்து இயக்கப்படுகின்றன. அவற்றை இயக்கும்போது YouTube-ன் சொந்த தனியுரிமைக் கொள்கை பொருந்தும்.
            </p>
            <p>
              Videos are embedded from YouTube. When you play one, YouTube&apos;s own privacy policy applies — see{' '}
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
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              தொடர்புப் படிவம் · Contact form
            </h2>
            <p className="mb-3 font-tamil">
              <Link href="/contact" className="text-orange-400 underline-offset-2 hover:underline">தொடர்புப் பக்கம்</Link> மூலம் நீங்களாகவே ஒரு செய்தி அனுப்பினால் மட்டுமே, அந்தச் செய்தியும் (உங்கள் மின்னஞ்சல் இருந்தால் அதுவும்) எனக்கு வரும். பதிலளிக்க மட்டுமே பயன்படுத்தப்படும்.
            </p>
            <p>
              Only when you send a message via the <Link href="/contact" className="text-orange-400 underline-offset-2 hover:underline">Contact page</Link>, that message (and your email, if provided) reaches us. It&apos;s used only to reply to you.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              கேள்விகள்? · Questions?
            </h2>
            <p className="mb-3 font-tamil">
              தனியுரிமை பற்றிய எந்தக் கேள்விக்கும்{' '}
              <Link href="/contact" className="text-orange-400 underline-offset-2 hover:underline">தொடர்பு கொள்ளுங்கள்</Link>.
            </p>
            <p>
              For any privacy question, please <Link href="/contact" className="text-orange-400 underline-offset-2 hover:underline">get in touch</Link>.
            </p>
          </section>

        </div>
      </main>
    </div>
  );
}
