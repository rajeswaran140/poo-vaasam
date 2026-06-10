/**
 * /terms — terms of use for a personal art/poetry site. Bilingual (Tamil +
 * English). Plain-spoken; covers copyright on Raj's original work, what
 * visitors can and can't do with it, and the usual "as-is, no warranty" clause.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';

const META_TITLE = 'Terms';
const META_DESCRIPTION =
  'Terms of use for Tamilagaval — copyright on original poems, songs and videos by Rajeswaran Thangarajah, plus what visitors may share.';

export const metadata: Metadata = {
  title: META_TITLE,
  description: META_DESCRIPTION,
  alternates: { canonical: '/terms' },
  robots: { index: true, follow: true },
};

const LAST_UPDATED = '30 May 2026';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Header />

      <section className="relative w-full overflow-hidden text-white">
        <div className="relative container mx-auto px-6 py-16 sm:px-10">
          <h1 className="font-kavivanar text-4xl font-extrabold leading-tight drop-shadow-md sm:text-5xl">
            விதிமுறைகள் · Terms
          </h1>
          <p className="mt-3 max-w-2xl font-tamil text-white/90">
            தமிழகவல் தளத்தைப் பயன்படுத்துவதற்கான எளிய விதிமுறைகள்.
          </p>
          <p className="mt-2 max-w-2xl text-white/80">
            Plain-English terms for using Tamilagaval.
          </p>
        </div>
      </section>

      <main id="main" className="container mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="mb-8 text-sm text-gray-500">
          கடைசியாகப் புதுப்பிக்கப்பட்டது · Last updated: {LAST_UPDATED}
        </p>

        <div className="space-y-10 leading-relaxed text-gray-300">

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              வரவேற்கிறோம் · Welcome
            </h2>
            <p className="mb-3 font-tamil">
              தமிழகவல் (tamilagaval.com) என்பது இராஜேஸ்வரன் தங்கராஜாவின் சொந்தக் கவிதைகள், பாடல்கள் மற்றும் காணொளிகளைப் பகிர்வதற்கான இலவச தனிப்பட்ட தளம். இத்தளத்தைப் பயன்படுத்துவதன் மூலம், கீழே உள்ள விதிமுறைகளை ஏற்றுக்கொள்கிறீர்கள்.
            </p>
            <p>
              Tamilagaval (tamilagaval.com) is a free, personal website for sharing original poems, songs and videos by Rajeswaran Thangarajah. By using the site, you agree to the terms below.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              பதிப்புரிமை · Copyright
            </h2>
            <p className="mb-3 font-tamil">
              இத்தளத்தில் உள்ள அனைத்து கவிதைகள், பாடல் வரிகள், இசை மற்றும் காணொளிகள் — © இராஜேஸ்வரன் தங்கராஜா. அனைத்து உரிமைகளும் பாதுகாக்கப்பட்டவை.
            </p>
            <p>
              All poems, lyrics, music and videos on this site are © Rajeswaran Thangarajah. All rights reserved.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              நீங்கள் என்ன செய்யலாம் · What you can do
            </h2>
            <p className="mb-3 font-tamil">
              தனிப்பட்ட பயன்பாட்டிற்கு வாசிக்கலாம், கேட்கலாம், பார்க்கலாம். ஆசிரியரின் பெயரையும், tamilagaval.com இணைப்பையும் சேர்த்து சமூக ஊடகங்களில் பகிரலாம்.
            </p>
            <p>
              You may read, listen and watch for personal enjoyment. You may share on social media, provided you credit Rajeswaran Thangarajah and link back to tamilagaval.com.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              நீங்கள் என்ன செய்யக்கூடாது · What you can&apos;t do
            </h2>
            <ul className="mb-3 list-disc space-y-1 pl-6 font-tamil">
              <li>எழுத்துப்பூர்வ அனுமதி இல்லாமல் உள்ளடக்கத்தை மறுவெளியீடு செய்தல், மறு உருவாக்கம் செய்தல், அல்லது விற்பனை செய்தல்.</li>
              <li>உள்ளடக்கத்தை மாற்றியமைத்து உங்கள் சொந்த படைப்பாகக் காட்டுதல்.</li>
              <li>விளம்பரம் அல்லது வணிக நோக்கத்திற்காகப் பயன்படுத்துதல்.</li>
              <li>தளத்தைச் சீர்குலைக்கும் வகையில் தானியங்கி கருவிகளால் அதிகமாக அணுகுதல்.</li>
            </ul>
            <ul className="list-disc space-y-1 pl-6">
              <li>Republish, reproduce or sell the content without written permission.</li>
              <li>Modify the content and present it as your own work.</li>
              <li>Use it for advertising or commercial purposes.</li>
              <li>Use automated tools to scrape the site in a way that disrupts service.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              அனுமதி · Permissions
            </h2>
            <p className="mb-3 font-tamil">
              வணிக ரீதியான பயன்பாடு, மீள்வெளியீடு, இசை அமைப்பு, அல்லது மொழிபெயர்ப்பு போன்ற எந்தவொரு பயன்பாட்டிற்கும்{' '}
              <Link href="/contact" className="text-orange-400 underline-offset-2 hover:underline">தொடர்பு கொள்ளுங்கள்</Link>.
            </p>
            <p>
              For any commercial use, republication, musical composition or translation, please{' '}
              <Link href="/contact" className="text-orange-400 underline-offset-2 hover:underline">get in touch</Link>.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              உத்தரவாதம் இல்லை · No warranty
            </h2>
            <p className="mb-3 font-tamil">
              தளம் &ldquo;உள்ளது போலவே&rdquo; (as-is) வழங்கப்படுகிறது. தொடர்ச்சியான பயன்பாட்டிற்கு உத்தரவாதம் இல்லை. யூடியூப் உள்ளிட்ட மூன்றாம் தரப்பு சேவைகள் தொடர்பான பிரச்சினைகளுக்கு பொறுப்பல்ல.
            </p>
            <p>
              The site is provided &ldquo;as is&rdquo;. We make no warranty of uninterrupted availability and are not liable for issues with third-party services (including YouTube) that the site embeds.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              மாற்றங்கள் · Changes
            </h2>
            <p className="mb-3 font-tamil">
              இந்த விதிமுறைகள் அவ்வப்போது புதுப்பிக்கப்படலாம். மேலே உள்ள தேதி கடைசி மாற்றத்தைக் காட்டுகிறது.
            </p>
            <p>
              These terms may be updated occasionally. The date above shows when they last changed.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-kavivanar text-2xl font-bold text-white">
              கேள்விகள்? · Questions?
            </h2>
            <p className="mb-3 font-tamil">
              <Link href="/contact" className="text-orange-400 underline-offset-2 hover:underline">தொடர்பு கொள்ளுங்கள்</Link> அல்லது{' '}
              <Link href="/privacy" className="text-orange-400 underline-offset-2 hover:underline">தனியுரிமை குறிப்பு</Link>-ஐப் பாருங்கள்.
            </p>
            <p>
              <Link href="/contact" className="text-orange-400 underline-offset-2 hover:underline">Get in touch</Link>, or read the{' '}
              <Link href="/privacy" className="text-orange-400 underline-offset-2 hover:underline">Privacy notice</Link>.
            </p>
          </section>

        </div>
      </main>
    </div>
  );
}
